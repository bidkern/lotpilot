# LotPilot

LotPilot is a production-minded dealer inventory platform for onboarding inventory sources, syncing vehicle data, and exporting reviewed listings from a tenant-scoped dashboard.

The project shows a full-stack SaaS workflow: Next.js App Router UI, Prisma/PostgreSQL data modeling, Playwright-backed source detection, background jobs, tenant-aware auth, CSV/JSON exports, and review-first safeguards for low-confidence automation.

## Core Workflow

1. A dealer creates a tenant workspace.
2. The dealer pastes an inventory source URL.
3. LotPilot runs layered source detection and previews sample vehicles.
4. Supported sources can be approved for scheduled sync.
5. Low-confidence sources stay in review instead of pretending automation is complete.
6. Managers filter inventory, queue exports, and download reviewed listing payloads.

## Why It Is Interesting

- Treats inventory ingestion as a confidence-scored pipeline instead of one brittle scraper.
- Keeps every query and mutation tenant-scoped with RBAC checks.
- Uses Playwright adapters where browser rendering is required, but isolates that behind source services.
- Queues sync/export work with retry and dead-letter behavior through `pg-boss`.
- Uses idempotency keys, audit logs, health metrics, and storage abstractions so the product reads like a real operations tool rather than a demo screen.

## Tech Stack

- `Next.js` App Router, React, TypeScript, Tailwind CSS
- `Prisma` and PostgreSQL
- `Auth.js` credentials auth with tenant roles
- `Playwright` for supported source adapters
- `pg-boss` for background work
- `Zod` for request and service validation
- Local or S3-compatible object storage for export/image artifacts

## Demo Status

No public hosted demo or committed screenshot set is included yet. For portfolio release, capture:

- onboarding URL detection
- preview approval
- admin inventory table
- source sync panel
- export download flow

The seed script can create a demo owner workspace, and the current supported adapter path is documented in [docs/SOURCE.md](docs/SOURCE.md).

## Local Setup

1. Copy environment settings:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Start local Postgres, or point `DATABASE_URL` at your own database:

```powershell
npm run db:start-local
```

4. Generate Prisma client and apply the schema:

```bash
npm run db:generate
npm run db:push
```

5. Seed a demo tenant owner:

```bash
npm run seed:admin
```

6. Install the Chromium browser used by Playwright adapters:

```bash
npx playwright install chromium
```

7. Run the app and worker in separate terminals:

```bash
npm run dev
npm run worker
```

Open `http://localhost:3000`.

## Environment

Required:

- `DATABASE_URL`
- `AUTH_SECRET`

Common local/demo values:

- `APP_URL`
- `ADMIN_EMAIL`
- `ADMIN_NAME`
- `ADMIN_PASSWORD`
- `SEED_DEMO_EMAIL`
- `SEED_DEMO_NAME`
- `SEED_DEMO_PASSWORD`
- `SEED_DEMO_TENANT_NAME`
- `SEED_DEMO_WEBSITE_URL`

Optional source/storage settings:

- `DEFAULT_SYNC_CRON`
- `JOBS_EXPORT_DIRECTORY`
- `STORAGE_PROVIDER`
- `STORAGE_LOCAL_DIRECTORY`
- `SCRAPER_HEADLESS`
- `PLAYWRIGHT_BROWSER`
- `S3_*`

Optional Meta/Page integration settings are present in `.env.example`, but a real Meta app and HTTPS webhook tunnel are required before those flows can complete.

## Verification

Use these before publishing the repo:

```bash
npm ci
npm run db:generate
npm run lint
npm run build
```

The GitHub Actions workflow in `.github/workflows/portfolio-checks.yml` runs the same lightweight portfolio checks.

## Repository Notes

- `legacy_github_imports/the-book-2026-04-29/` is retained as imported historical source and excluded from the active TypeScript build. Before making the repo public, either move it to a separate archive branch or document exactly why it remains in-tree.
- Runtime state, local databases, generated exports, and real secrets should stay out of version control.
- The product supports reviewable export queues and downstream listing payloads. It does not claim universal direct marketplace auto-posting.

## Important Files

- [prisma/schema.prisma](prisma/schema.prisma) - tenant, inventory, sync, export, audit, and marketplace models
- [src/components/onboarding-wizard.tsx](src/components/onboarding-wizard.tsx) - URL detection and approval flow
- [src/components/inventory-dashboard.tsx](src/components/inventory-dashboard.tsx) - admin inventory workspace
- [src/lib/services/detection-service.ts](src/lib/services/detection-service.ts) - source detection orchestration
- [src/lib/services/inventory-service.ts](src/lib/services/inventory-service.ts) - tenant-scoped inventory operations
- [src/lib/services/export-service.ts](src/lib/services/export-service.ts) - reviewed export pipeline
- [scripts/seed-admin.ts](scripts/seed-admin.ts) - demo owner workspace seeding

## Portfolio Metadata

Suggested GitHub description:

```text
Dealer inventory onboarding, sync, and export platform built with Next.js, Prisma, PostgreSQL, Playwright, and background jobs.
```

Suggested topics:

```text
nextjs, typescript, prisma, postgresql, playwright, inventory-management, saas, multi-tenant, authjs, dealer-tools
```

## License

MIT. See [LICENSE](LICENSE).
