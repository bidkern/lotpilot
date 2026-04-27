# LotPilot

LotPilot is a production-minded multi-tenant dealer inventory onboarding, sync, and export platform built with Next.js, TypeScript, Prisma, PostgreSQL, Playwright, Auth.js, Zod, and `pg-boss`.

The dealer UX is intentionally simple:

1. Paste a dealership URL
2. Auto-detect the inventory structure
3. Preview sample vehicles
4. Approve the source
5. Let scheduled syncs populate the tenant workspace
6. Manage inventory and export selected vehicles for downstream listing workflows

Under the hood, the app does not pretend one generic scraper can solve every site. It uses layered detection and keeps low-confidence results in review instead of falsely claiming full automation.

## Architecture Overview

- `Next.js App Router` serves the onboarding flow, tenant dashboard, and API routes.
- `PostgreSQL + Prisma` store tenants, users, memberships, inventory sources, source profiles, vehicles, snapshots, change events, sync runs, export jobs, and audit logs.
- `Playwright` powers source adapters for supported dealership site templates.
- `pg-boss` handles background jobs for source sync, vehicle refresh, and export generation with retry and dead-letter queue support.
- `Auth.js` provides secure credentials login with tenant-scoped sessions and RBAC.
- `Zod` validates API payloads for registration, onboarding, bulk actions, and sync requests.
- Shared runtime services handle browser pooling, idempotency keys, source health alerts, and local/S3-compatible object storage.

## Source Detection Strategy

When a dealership URL is entered, the app tries sources in this order:

1. Discoverable inventory feed URL
2. JSON-LD / structured data
3. Known website platform template detection
4. Generic crawler + pattern detection
5. Manual review fallback

Current automated adapter support:

- `DealerOn SearchAll` style inventory sites, including `woosterdodgejeep.com`

Current honest fallback behavior:

- feed / structured data / generic crawler previews can be saved
- low-confidence detections remain review-required instead of auto-activating

## Prisma Data Model

Core multi-tenant models in [`prisma/schema.prisma`](/Users/adelm/Desktop/Car Stuff/prisma/schema.prisma):

- `Tenant`
- `User`
- `TenantMembership`
- `Subscription`
- `InventorySource`
- `SourceProfile`
- `SourceDetectionRun`
- `ExtractionRule`
- `FieldMapping`
- `Vehicle`
- `VehicleImage`
- `VehicleSnapshot`
- `VehicleChangeEvent`
- `SyncRun`
- `SyncHealthMetric`
- `BackgroundJob`
- `ExportJob`
- `ExportJobItem`
- `AuditLog`

Important enums:

- `UserRole`: `OWNER`, `ADMIN`, `MANAGER`, `AGENT`
- `InventorySourceStatus`: `DRAFT`, `DETECTING`, `REQUIRES_REVIEW`, `ACTIVE`, `PAUSED`, `ARCHIVED`, `FAILED`
- `VehicleLifecycleStatus`: `ACTIVE`, `STALE`, `ARCHIVED`, `REMOVED`
- `VehicleExportStatus`: `NOT_EXPORTED`, `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`
- `QueueJobType`: `SOURCE_SYNC`, `VEHICLE_REFRESH`, `EXPORT_GENERATION`

## Folder Structure

```text
src/
  app/
    admin/                         tenant inventory dashboard
    login/                         sign-in page
    onboarding/                    URL -> detect -> preview -> approve flow
    register/                      tenant + owner registration
    api/
      admin/
        exports/[exportJobId]/download/
        inventory/
          route.ts
        inventory/bulk/
        inventory/sync/
        vehicle-images/[vehicleImageId]/
      auth/[...nextauth]/
      onboarding/approve/
      onboarding/detect/
      register/
  components/
    inventory-dashboard.tsx        filters, table, row checkboxes, bulk actions, detail modal
    login-form.tsx
    onboarding-wizard.tsx
    register-form.tsx
  lib/
    source-adapters/               reusable site adapters
      playwright-pool.ts           shared Playwright browser/context pool
    services/
      bootstrap-service.ts
      detection-service.ts
      export-service.ts
      idempotency-service.ts
      inventory-service.ts
      job-service.ts
      media-service.ts
      onboarding-service.ts
      tenant-service.ts
    authz.ts
    request-auth.ts
    marketplace.ts
    prisma.ts
    queue.ts
    storage.ts
scripts/
  seed-admin.ts                    seeds a demo tenant owner workspace
  run-source-sync.ts               runs an immediate sync for an active source
  register-schedules.ts            registers recurring pg-boss schedules
  start-worker.ts                  background worker
```

## Backend Endpoints

- `POST /api/register`
  Creates the first tenant owner account and workspace.

- `POST /api/onboarding/detect`
  Runs layered source detection, persists a `SourceDetectionRun`, and returns a sample preview.

- `POST /api/onboarding/approve`
  Converts a detection result into a reusable `SourceProfile`, activates supported sources, and queues the initial sync.

- `POST /api/admin/inventory/sync`
  Queues one or more tenant-scoped source sync jobs. Requires `MANAGER` or higher.

- `GET /api/admin/inventory`
  Returns tenant-scoped, server-filtered, paginated inventory data for the dashboard table.

- `POST /api/admin/inventory/bulk`
  Handles tenant-scoped bulk actions: `export`, `refresh`, `archive`, `markExported`, with manual, filtered, or all-inventory selection scopes.

- `GET /api/admin/exports/[exportJobId]/download`
  Downloads a completed tenant export artifact.

- `GET /api/admin/vehicle-images/[vehicleImageId]`
  Streams a tenant-scoped cached image from local or S3-compatible storage.

## Onboarding Flow

The dealer onboarding wizard in [`src/components/onboarding-wizard.tsx`](/Users/adelm/Desktop/Car Stuff/src/components/onboarding-wizard.tsx) implements:

1. URL input
2. detection request
3. preview result with confidence + strategy
4. approval step
5. source activation for supported sites
6. review-required save path for low-confidence sites

The onboarding service in [`src/lib/services/onboarding-service.ts`](/Users/adelm/Desktop/Car Stuff/src/lib/services/onboarding-service.ts) persists:

- `InventorySource`
- `SourceDetectionRun`
- `SourceProfile`
- `ExtractionRule`
- `FieldMapping`

## Inventory Dashboard

The dashboard in [`src/components/inventory-dashboard.tsx`](/Users/adelm/Desktop/Car Stuff/src/components/inventory-dashboard.tsx) includes:

- search by VIN, stock number, make, model
- filters for make, model, year, price, workflow status, export status
- server-side pagination with tenant-safe server filtering
- row checkbox selection
- select page
- select filtered
- select all inventory
- clear selection
- bulk export
- bulk archive
- bulk refresh
- bulk mark exported
- source sync controls
- source health alert visibility
- sync run panel
- export job panel
- vehicle detail modal
- snapshot and change-event history

## Export Workflow

The export pipeline in [`src/lib/services/export-service.ts`](/Users/adelm/Desktop/Car Stuff/src/lib/services/export-service.ts) works like this:

1. Selected vehicles create an `ExportJob`
2. Each vehicle gets an `ExportJobItem`
3. Vehicle export status moves through `QUEUED` -> `PROCESSING` -> `COMPLETED` or `FAILED`
4. The worker writes a CSV or JSON file through the storage abstraction to local disk or S3-compatible object storage
5. The dashboard exposes the download link when the job completes

Runtime improvements in this version:

- idempotent export and sync queue creation
- dead-letter queue handling after retry exhaustion
- optional image caching into object storage
- browser pooling and batched inventory persistence
- source health alert generation for failed syncs, field coverage drops, stale spikes, and sharp inventory drops

Supported, policy-safe workflow:

- reviewable export queue
- CSV / JSON payload generation
- manual downstream posting

Unsupported claim we do not make:

- universal direct Facebook Marketplace auto-posting for every dealer

## Meta Setup

The Book is ready for tenant-scoped Facebook Page connection, but you still need a real Meta app before the `Connect Facebook` flow can succeed.

Local env values already expected by the app:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI`
- `META_VERIFY_TOKEN`
- `META_TOKEN_ENCRYPTION_KEY`

Update [`.env`](/Users/adelm/Desktop/Car Stuff/.env) with your real `META_APP_ID` and `META_APP_SECRET`. The local redirect URI is already set to:

- `http://localhost:3000/api/meta/callback`

The local webhook route in the app is:

- `http://localhost:3000/api/meta/webhook`

Recommended Meta app setup:

1. Create a Meta app in the Meta developer dashboard.
2. Add `Facebook Login`.
3. Add `Messenger`.
4. Add `Webhooks`.
5. Set the Facebook Login redirect URI to `http://localhost:3000/api/meta/callback`.
6. Set the webhook callback URL to a public HTTPS tunnel that forwards to `http://localhost:3000/api/meta/webhook`.
7. Set the webhook verify token to the same value as `META_VERIFY_TOKEN` in `.env`.
8. Request the Page scopes used by the app:
   - `pages_manage_metadata`
   - `pages_messaging`
   - `pages_read_engagement`
   - `pages_show_list`
9. Connect with a Facebook account that manages at least one Page.
10. Return to `/admin` and click `Connect Facebook`.

Important local-dev note:

- Facebook Login can use the localhost callback above.
- Webhook delivery usually needs a public HTTPS URL, so for local testing you will typically need a tunnel such as `ngrok` or `cloudflared` that forwards to port `3000`.

Once connected, the app will:

- store the Facebook identity as a tenant-scoped `MetaAuthAccount`
- let that tenant activate one or more Pages
- track per-vehicle publication state
- prevent duplicate publication tracking for the same vehicle/person combination

Helpful official docs:

- [Meta Facebook Login](https://developers.facebook.com/docs/facebook-login/)
- [Meta Messenger Platform](https://developers.facebook.com/docs/messenger-platform/overview/)
- [Meta Graph API Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
- [Meta Pages API](https://developers.facebook.com/docs/pages-api/)

## Auth and Tenant Isolation

- Sessions include `tenantId`, `tenantName`, `role`, and `status`
- Every dashboard/service query is tenant-scoped
- Related rows like `VehicleImage`, `ExportJobItem`, `SyncRun`, and `AuditLog` carry `tenantId`
- RBAC helpers enforce `OWNER`, `ADMIN`, `MANAGER`, `AGENT`
- Bulk actions and downloads validate both auth and tenant ownership

## Environment Variables

See [`.env.example`](/Users/adelm/Desktop/Car Stuff/.env.example).

Required:

- `DATABASE_URL`
- `AUTH_SECRET`

Recommended:

- `APP_URL`
- `DEFAULT_SYNC_CRON`
- `JOBS_EXPORT_DIRECTORY`
- `STORAGE_PROVIDER`
- `STORAGE_LOCAL_DIRECTORY`
- `SCRAPER_DETAIL_CONCURRENCY`
- `INVENTORY_PERSIST_BATCH_SIZE`
- `IMAGE_CACHE_ENABLED`
- `IMAGE_CACHE_LIMIT_PER_VEHICLE`
- `SCRAPER_HEADLESS`
- `PLAYWRIGHT_BROWSER`

Optional S3-compatible storage:

- `S3_BUCKET_NAME`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`
- `S3_PUBLIC_BASE_URL`

Optional demo seeding:

- `SEED_DEMO_EMAIL`
- `SEED_DEMO_NAME`
- `SEED_DEMO_PASSWORD`
- `SEED_DEMO_TENANT_NAME`
- `SEED_DEMO_WEBSITE_URL`

## Local Setup

1. Create a PostgreSQL database.
2. Copy [`.env.example`](/Users/adelm/Desktop/Car Stuff/.env.example) to `.env` and fill in the values.
3. Install dependencies:

```bash
npm install
```

4. Generate Prisma client and push the schema:

```bash
npm run db:generate
npm run db:push
```

5. Seed a demo owner workspace if desired:

```bash
npm run seed:admin
```

6. Install the Playwright browser:

```bash
npx playwright install chromium
```

7. Start the background worker and app:

```bash
npm run worker
npm run dev
```

Optional recurring sync registration:

```bash
npm run schedule:jobs
```

Optional one-off sync for the latest active source:

```bash
npm run sync:inventory
```

## Verification

Verified in this environment:

- `npx prisma validate`
- `npx prisma generate`
- `npm run lint`
- `npm run build`

Live source-detection verification against `https://www.woosterdodgejeep.com`:

- adapter: `dealeron`
- strategy: `PLATFORM_TEMPLATE`
- confidence: `0.92`
- preview vehicles: `6`
- review required: `false`
