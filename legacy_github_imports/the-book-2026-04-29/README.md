# The Book

`The Book` is a production-minded SaaS starter for local car dealerships that need:

- multi-tenant parent account management
- employee rotation for listing ownership
- compliant assisted publishing workflows
- normalized vehicle inventory ingestion
- a recent-conversations inbox
- reporting for coverage, response load, and listing velocity

## Stack

- Next.js App Router
- React 19 + TypeScript
- Tailwind CSS v4
- Prisma + PostgreSQL
- BullMQ + Redis
- Zod validation

## Run locally

1. Copy `.env.example` to `.env`.
2. Create a PostgreSQL database and Redis instance.
3. Install dependencies.
4. Generate the Prisma client.
5. Start the app.

```bash
npm install
npm run db:generate
npm run dev
```

Open `http://localhost:3000`.

## Important files

- `docs/technical-plan.md`: full planning document and implementation blueprint
- `prisma/schema.prisma`: multi-tenant schema starter
- `src/app`: Next.js pages and route handlers
- `src/lib/rotation-engine.ts`: assignment loop logic and pseudocode
- `src/lib/job-names.ts`: BullMQ queue and job naming starter

## Product constraints

This starter does not assume unrestricted Facebook Marketplace automation.

- Prefer official APIs when they exist and are explicitly allowed.
- Default to assisted workflows when direct posting is unavailable or restricted.
- Keep human review, reminders, task routing, and audit logging in the core design.
