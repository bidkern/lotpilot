# The Book Technical Plan

## Assumptions

- `The Book` is a B2B SaaS sold to dealership groups as parent accounts.
- A parent account may own one dealership at MVP launch, but the schema supports multiple rooftops.
- Facebook Marketplace posting automation must be treated as restricted unless an official supported path is documented and approved.
- The first production version should optimize for operational reliability, observability, and compliance over automation breadth.

## 1. System overview

### What the platform does

`The Book` helps local dealerships keep inventory synced, route listing work to the right employee, prepare compliant listing drafts, and manage customer conversations from a dealership-focused operations console.

### Key users

- `Parent account owner`: owns subscription, billing, account defaults, and security settings.
- `Admin or manager`: manages employees, rotation order, inventory sources, overrides, and reporting.
- `Employee`: connects a Facebook account, receives listing tasks, reviews drafts, and handles assigned conversations.

### Core modules

- Multi-tenant account and membership management
- Inventory ingestion and normalization
- Rotation engine and assignment audit trail
- Listing lifecycle and posting queue
- Employee social account connections
- Inbox and conversation ownership
- Notifications, activity, and audit logs
- Billing and reporting

## 2. MVP definition

### Build first

- Parent account creation and tenant-scoped RBAC
- Employee membership management under a parent account
- One dealership per parent account at launch, multi-dealer ready schema
- Inventory source onboarding for feed polling and webhook ingestion
- Vehicle normalization and deduplication
- Inventory table with filters for price, make, model, time on lot, miles, listed state, and listing owner
- Rotation order configuration
- Assignment engine with skips, cooldowns, throttles, duplicate prevention, override support, and audit logs
- Human-assisted listing workflow with states:
  - `eligible`
  - `queued`
  - `assigned`
  - `draft_ready`
  - `needs_review`
  - `posted`
  - `failed`
  - `archived`
- Employee Facebook connection status tracking
- Conversation bucket with unread counts, notes, and escalation
- Basic reporting for coverage, time to listing, response load, and stale inventory

### Defer

- Full multi-rooftop switching UX
- AI copy optimization beyond structured draft generation
- Complex lead attribution and deal-close attribution
- SMS/email conversation channels beyond Marketplace-linked workflows
- Marketplace A/B testing or scheduling optimization
- Enterprise SSO and SCIM
- Cross-parent shared staff pools

## 3. Recommended stack

| Layer | Default | Why |
| --- | --- | --- |
| Frontend | Next.js App Router + React 19 + TypeScript | One deployment surface for dashboard, SSR pages, and API handlers |
| Backend | Next.js route handlers on Node.js | Keeps MVP simple and lets you split workers later |
| Database | PostgreSQL | Best fit for relational tenant data, inbox state, and reporting |
| ORM | Prisma | Fast schema iteration and strong TypeScript ergonomics |
| Auth | Auth.js with custom RBAC tables | Keeps user, membership, and dealership logic in your own schema |
| Queue/jobs | BullMQ + Redis | Reliable enough for sync jobs, retries, reminders, and queue inspection |
| Realtime | SSE first | Enough for queue status and unread counters without extra vendor complexity |
| File storage | S3-compatible object storage | Vehicle images, draft assets, and import artifacts |
| Billing | Stripe | Straightforward parent-account subscription ownership |
| Observability | Sentry + structured logs + queue metrics | Needed for ingestion failures and workflow drift |

### Why this default is the smartest path

- It is small-team friendly.
- It avoids premature service sprawl.
- It keeps the queue and database explicit.
- It does not lock the product into brittle browser automation.

## 4. Multi-tenant architecture

### Tenant model

- `parent_accounts` is the billing and isolation root.
- `dealerships` belong to one parent account.
- `users` are global identities.
- `memberships` join users to parent accounts and optionally to a dealership.
- Every domain entity that matters operationally carries either `parent_account_id`, `dealership_id`, or both.

### Isolation rules

- Every authenticated request resolves a current parent account.
- Every query must scope by `parent_account_id`.
- Dealership-level pages add `dealership_id` filtering on top of the tenant filter.
- Background jobs must carry `tenantId` and usually `dealershipId` in payloads.
- Audit logs and webhook events should persist tenant identifiers even on failure paths.

### Roles and permissions

- `OWNER`: billing, tenant settings, overrides, integrations
- `ADMIN`: employee management, queue actions, reports, settings
- `MANAGER`: review queue, conversation escalation, manual reassignment
- `EMPLOYEE`: assigned inventory, own drafts, own conversations
- `BILLING`: invoices and subscription only

### Subscription ownership

- Stripe customer and subscription live on `parent_accounts`.
- Seat counting is derived from active memberships, not raw users.
- Billing state can disable premium features without destroying tenant data.

## 5. Domain model / database schema

The implemented Prisma starter is in `prisma/schema.prisma`. Key entities:

| Entity | Important fields | Relationships | Critical indexes / notes |
| --- | --- | --- | --- |
| `parent_accounts` | `name`, `slug`, `status`, `billing_owner_user_id`, `rotation_cursor_membership_id`, cooldown and throttle defaults | has many dealerships, memberships, subscriptions, listings, logs | unique `slug`; keep cursor on tenant root |
| `dealerships` | `parent_account_id`, `name`, `slug`, `status`, `timezone` | belongs to parent account; has memberships, sources, vehicles | unique `(parent_account_id, slug)` |
| `users` | `email`, names, `status` | has many memberships | unique `email` |
| `memberships` | `parent_account_id`, `dealership_id`, `user_id`, `role`, `status`, `rotation_position` | joins users to tenants; owns social accounts and queue ownership | unique `(parent_account_id, user_id)`; index on role, status, rotation |
| `subscriptions` | provider ids, `plan_code`, `seat_count`, billing dates, `status` | belongs to parent account | index on `(parent_account_id, status)` |
| `inventory_sources` | `type`, `provider`, `status`, `poll_interval_minutes`, sync timestamps, `settings` | belongs to dealership; has vehicles and webhook events | index on `(dealership_id, status)` |
| `vehicles` | `source_vehicle_key`, `stock_number`, `vin`, pricing, miles, `time_on_lot_days`, `status`, `listed_on_facebook` | belongs to dealership and source; has images, assignments, listings, conversations | unique `(dealership_id, source_vehicle_key)`; indexes for table filters |
| `listing_assignments` | assignee, creator, `assignment_mode`, `status`, `admin_override`, `requeue_count` | links vehicle to employee ownership decisions | indexes by vehicle, assignee, status |
| `listings` | owner membership, social account, `channel`, `mode`, `status`, external ids, draft payload, failure fields | belongs to vehicle and optional assignment | indexes by tenant, vehicle, channel, status |
| `employee_social_accounts` | provider, account id, encrypted tokens, expiry, `status`, `scopes` | belongs to membership; feeds listing ownership eligibility | unique per membership and provider |
| `posting_queue` | `job_type`, `status`, `priority`, `run_at`, `attempts`, `payload` | belongs to vehicle, assignment, optional listing | indexes by status, run time, assignee |
| `conversations` | owner membership, `external_thread_id`, customer fields, unread count, escalation timestamps | belongs to tenant, dealership, optional vehicle/listing | unique `(dealership_id, external_thread_id)`; inbox indexes |
| `messages` | `direction`, `body`, author membership, external id, `sent_at` | belongs to conversation | index on `(conversation_id, sent_at)` |
| `activity_logs` | `kind`, `summary`, `metadata` | belongs to tenant, optional dealership, vehicle, listing, conversation | optimized for operator-facing timelines |
| `audit_logs` | actor, action, target, request metadata, before/after JSON | belongs to tenant, optional dealership | optimized for compliance and investigations |
| `webhook_events` | provider, `delivery_id`, `event_type`, signature result, processing result, payload | optional tenant and source links | unique `(provider, delivery_id)` |
| `notifications` | recipient membership, type, channel, status, schedule and read timestamps | belongs to tenant and optional listing/conversation | indexes for dispatch and inbox read state |

### Status and enum guidance

- Keep workflow enums explicit instead of hiding meaning in booleans.
- Do not encode lifecycle meaning inside free-form strings.
- Never use listing status alone to infer vehicle stock status.
- Never use conversation unread count alone to infer escalation.

## 6. Rotation engine design

### Requirements covered

- Parent account defines employee order
- Assignment loops continuously
- Skip inactive employees
- Skip disconnected integrations
- Avoid duplicate active listings for same vehicle
- Support cooldowns and throttles
- Allow admin override
- Preserve audit trail
- Support requeue and retry

### Algorithm

1. Receive assignment request with `tenantId`, `dealershipId`, `vehicleId`, and optional override.
2. Load tenant defaults:
   - `rotation_cursor_membership_id`
   - `listing_cooldown_minutes`
   - `max_pending_assignments_per_employee`
   - `daily_listing_limit`
3. Block immediately if the vehicle already has an active listing in a non-terminal state.
4. If override exists:
   - validate the employee exists in the tenant
   - validate eligibility
   - create assignment with `admin_override = true`
5. Otherwise order memberships by `rotation_position`.
6. Start scanning at `cursor + 1`.
7. For each candidate:
   - skip if membership inactive
   - skip if social account disconnected, expired, or errored
   - skip if cooldown not elapsed
   - skip if daily listing limit reached
   - skip if pending queue count exceeds cap
8. Assign first eligible employee.
9. Persist:
   - `listing_assignments`
   - updated tenant cursor
   - `posting_queue` job for draft generation
   - `activity_logs`
   - `audit_logs`
10. If no candidate qualifies:
   - create blocked queue record
   - notify manager/admin

### Edge cases

- Rotation cursor points to a deleted or inactive membership
- All employees are skipped
- Vehicle becomes sold between eligibility check and queue insert
- Requeue occurs after previous draft or publish failure
- Manager override targets a disconnected account
- Employee reconnects Facebook after being skipped

### Pseudocode

```txt
assign(vehicleId, tenantId, overrideMembershipId?):
  vehicle = loadVehicle(vehicleId, tenantId)
  if hasActiveListing(vehicleId):
    return blocked("vehicle_already_has_active_listing")

  employees = loadRotationMembers(tenantId)

  if overrideMembershipId:
    candidate = findEmployee(overrideMembershipId)
    validateEligible(candidate)
    return persistAssignment(candidate, adminOverride=true)

  cursor = loadTenantCursor(tenantId)
  ordered = sortByRotationPosition(employees)

  for candidate in loopFromNext(cursor, ordered):
    if candidate.inactive: continue
    if candidate.integrationDisconnected: continue
    if candidate.cooldownActive: continue
    if candidate.dailyLimitReached: continue
    if candidate.pendingQueueCapReached: continue
    return persistAssignment(candidate, adminOverride=false)

  createBlockedQueueRecord(vehicleId, tenantId)
  notifyManager()
  return blocked("no_eligible_employee")
```

## 7. Inventory ingestion design

### Polling vs webhooks

- Support both.
- Prefer webhooks for freshness where the DMS offers them.
- Keep feed polling as a backstop for eventual consistency and providers with weak webhook coverage.
- Store per-source sync health so admins can see degraded sources.

### Normalization layer

- Map source-specific payloads into a canonical vehicle shape.
- Normalize:
  - stock number
  - VIN
  - price
  - mileage
  - photos
  - status
  - timestamps
- Keep raw payload metadata for debugging.

### Deduplication

- Primary key per source: `(dealership_id, source_vehicle_key)`
- Secondary matching fallback: VIN plus dealership
- Never merge across parent accounts

### Vehicle status changes

- `IN_STOCK` remains eligible for listing workflows
- `RESERVED` should pause new listing work and flag for review
- `SOLD` should archive listings and close pending publishing jobs
- `ARCHIVED` should hide from active tables but preserve reporting history

### Image syncing

- Store source image keys and checksums where available
- Re-sync image set when checksum or count changes
- Reorder by source order
- Requeue draft generation if image set materially changes

### Error handling

- Persist webhook receipt before processing
- Retry transient normalization failures
- Mark sync runs degraded after repeated failure
- Keep idempotent upserts for webhook redelivery

### Observability

- Source health panel with last sync, last webhook, error count
- Queue metrics for normalization jobs
- Audit trail for inventory status changes affecting listings

## 8. Listing management flow

### Official direct integration path

- Only enable for surfaces where official support is documented
- Flow:
  - `eligible`
  - `queued`
  - `assigned`
  - `draft_ready`
  - `needs_review`
  - `posted`
  - `archived` or `failed`
- Keep same audit and notification model as assisted path

### Human-assisted fallback path

- Default path for Marketplace-sensitive workflows
- Flow:
  - `eligible`: vehicle qualifies for listing
  - `queued`: waiting for rotation or job execution
  - `assigned`: employee selected
  - `draft_ready`: copy, price, and photos prepared
  - `needs_review`: human must inspect or publish
  - `posted`: employee confirms publication or system sync confirms it
  - `failed`: publish reminder expired or review failed
  - `archived`: listing no longer actionable

### Compliance posture

- No stealth automation
- No bot evasion
- No policy-violating browser scripting
- Human actions remain visible and attributable

## 9. Messaging / inbox design

- `conversations` are tenant-scoped threads, usually linked to a listing and vehicle
- `messages` support:
  - inbound customer messages
  - outbound employee replies
  - internal notes
- `owner_membership_id` defines who owns the thread
- `unread_count` lives on conversation for fast inbox rendering
- Managers can:
  - reassign ownership
  - escalate a thread
  - add notes
- Filters:
  - unread
  - assigned to me
  - escalated
  - by vehicle
  - by employee
  - by listing channel

## 10. API design

### Session and auth

- `GET /api/auth/session`

### Tenant management

- `GET /api/tenants/:tenantId`
- `PATCH /api/tenants/:tenantId`

### Employee management

- `GET /api/tenants/:tenantId/employees`
- `POST /api/tenants/:tenantId/employees`
- `PATCH /api/tenants/:tenantId/employees/:membershipId`

### Inventory

- `GET /api/tenants/:tenantId/inventory`
- `GET /api/tenants/:tenantId/inventory/:vehicleId`
- `POST /api/tenants/:tenantId/inventory/sync`

### Listings and assignments

- `POST /api/tenants/:tenantId/assignments`
- `GET /api/tenants/:tenantId/listings`
- `PATCH /api/tenants/:tenantId/listings/:listingId`

### Queue

- `GET /api/tenants/:tenantId/queue`
- `POST /api/tenants/:tenantId/queue/:queueId/retry`

### Conversations

- `GET /api/tenants/:tenantId/conversations`
- `PATCH /api/tenants/:tenantId/conversations/:conversationId`
- `POST /api/tenants/:tenantId/conversations/:conversationId/notes`

### Analytics

- `GET /api/tenants/:tenantId/analytics`

### Webhooks

- `POST /api/webhooks/inventory`

## 11. Background jobs / queue design

- `inventory.sync.requested`
- `inventory.normalize.batch`
- `inventory.vehicle.upsert`
- `listing.assignment.requested`
- `listing.draft.generate`
- `listing.publish.attempt`
- `listing.retry.schedule`
- `listing.stale.cleanup`
- `conversation.sync.requested`
- `conversation.unread.refresh`
- `notification.dispatch`

### Queue rules

- Keep job payloads tenant-scoped
- Make inventory and webhook jobs idempotent
- Separate publish attempts from draft generation
- Keep retry policies explicit per job type

## 12. Frontend app structure

- `/`: dashboard
- `/inventory`: filterable inventory table
- `/employees`: employee roster and rotation order
- `/queue`: publishing queue and policy-aware workflow
- `/inbox`: conversation bucket
- `/reports`: operational metrics
- `/settings`: integrations, rules, and security controls
- `/billing`: subscription and seats

## 13. UX implementation guidance

- Tables should support sticky headers, dense rows, and clear empty states
- Use chips or badges for statuses instead of raw text
- Keep filters visible above tables, not buried in drawers
- Use right-side drawers for edit workflows
- Use modals for short confirmation tasks only
- Empty states should explain what unlocks the next step
- Light mode and dark mode should share the same hierarchy, not become separate designs
- Brand usage:
  - `#101720` for structure and contrast
  - `#477754` for success, primary actions, and active states
  - `#EFCE9D` for review, caution, and assisted-work emphasis
  - `#F9F9F9` for cards and readable surfaces

## 14. Security / compliance considerations

- Enforce tenant scoping on every query and job payload
- Encrypt OAuth access and refresh tokens at rest
- Store app secrets outside source control
- Log every override, role change, and publish-related status transition
- Validate webhook signatures before enqueueing downstream work
- Rate-limit public endpoints and webhook ingestion
- Prefer server-side token use over client-side exposure
- Separate activity logs from immutable audit logs
- Avoid scraping or unauthorized automation workflows

## 15. Analytics and reporting

Useful dealership reports:

- Listings posted by employee
- Inventory not yet listed
- Median time to listing after inventory arrival
- Conversation volume by employee
- Unread backlog by employee
- Follow-up lag
- Stale inventory with no live listing
- Sold unit attribution, only if a trustworthy source exists

## 16. Repository structure

```txt
prisma/
  schema.prisma
docs/
  technical-plan.md
src/
  app/
    api/
    billing/
    employees/
    inbox/
    inventory/
    queue/
    reports/
    settings/
  components/
    conversations/
    inventory/
    providers/
    shell/
    ui/
  lib/
    api/
    demo-data.ts
    format.ts
    job-names.ts
    rotation-engine.ts
    types.ts
    validation.ts
```

## 17. Initial code scaffolding

This starter already includes:

- Multi-page Next.js shell branded as `The Book`
- Tenant-scoped API route stubs
- Prisma schema for the requested domain
- Queue and job naming starter
- Rotation engine implementation scaffold
- Demo data for inventory, employees, queue, and inbox

## 18. Build order

1. Auth and tenant resolution
2. Parent account, dealership, membership schema
3. Inventory source onboarding and normalization
4. Inventory table and vehicle detail
5. Employee connection state and rotation order management
6. Assignment engine and queue persistence
7. Draft generation and assisted publish workflow
8. Inbox and conversation ownership
9. Notifications and escalations
10. Reporting and billing polish

## 19. Final recommendation

The smartest version of this product is not a fully automated Marketplace bot. It is a reliable dealership operations system that keeps inventory clean, routes work intelligently, prepares excellent drafts, and gives humans clear next actions.

### What to avoid

- Browser automation that violates platform rules
- Overbuilding microservices before job volume demands it
- Embedding tenant logic only in the UI instead of the database and API
- Treating inventory ingestion as a side concern instead of a core product surface

### Where engineers usually overcomplicate it

- They jump to Temporal too early instead of starting with BullMQ
- They mix user identity with tenant membership
- They hide state transitions in booleans instead of explicit status enums
- They build too many inbox abstractions before nailing ownership and unread counts
