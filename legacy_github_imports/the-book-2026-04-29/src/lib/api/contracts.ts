import type { EndpointDefinition, StackChoice } from "@/lib/types";

export const recommendedStack: StackChoice[] = [
  {
    layer: "Frontend",
    selection: "Next.js App Router + React 19 + TypeScript",
    rationale:
      "Fast product iteration, server components for dashboard pages, and one deployment surface for app plus API.",
  },
  {
    layer: "Backend",
    selection: "Next.js route handlers on Node.js",
    rationale:
      "Keeps MVP simple. Split out worker processes only when queues and sync volume justify it.",
  },
  {
    layer: "Database",
    selection: "PostgreSQL",
    rationale:
      "Strong relational modeling for multi-tenant data, inbox state, audit trails, and reporting.",
  },
  {
    layer: "ORM",
    selection: "Prisma",
    rationale:
      "Quick schema evolution, readable relations, and good TypeScript ergonomics for a small team.",
  },
  {
    layer: "Auth",
    selection: "Auth.js with custom RBAC tables",
    rationale:
      "Keeps tenant membership and dealership roles in your own schema without forcing org abstractions.",
  },
  {
    layer: "Queue",
    selection: "BullMQ + Redis",
    rationale:
      "Reliable enough for ingestion, assignment, retries, and reminders without Temporal-level overhead.",
  },
  {
    layer: "Realtime",
    selection: "SSE first, Ably later if inbox volume grows",
    rationale:
      "SSE covers admin dashboards and queue progress. Upgrade only if two-way realtime becomes critical.",
  },
];

export const apiCatalog: EndpointDefinition[] = [
  {
    method: "GET",
    path: "/api/auth/session",
    purpose: "Return the current authenticated user and tenant context.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/employees",
    purpose: "List tenant-scoped employees with roles, rotation position, and connection state.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/inventory",
    purpose: "Return normalized vehicle inventory with filters and listing state.",
  },
  {
    method: "POST",
    path: "/api/tenants/:tenantId/assignments",
    purpose: "Trigger the rotation engine for a vehicle or allow an admin override.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/queue",
    purpose: "Inspect posting tasks, retry status, and scheduled assisted-publishing work.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/conversations",
    purpose: "Load the employee inbox bucket with unread counts and escalation state.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/sales-floor",
    purpose: "Load the persisted deal ledger, desk queue, and sales-floor snapshot for one tenant.",
  },
  {
    method: "PATCH",
    path: "/api/tenants/:tenantId/deals/:dealId",
    purpose: "Apply salesperson or manager actions that advance deal stage, handoff status, or outcome.",
  },
  {
    method: "POST",
    path: "/api/tenants/:tenantId/deals/:dealId/notes",
    purpose: "Append an internal deal note and keep the audit trail attached to the live record.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/agent/tasks",
    purpose: "Inspect autonomous worker tasks, pending follow-ups, and the latest run summary.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/appointments",
    purpose: "Read the live appointment book so confirmations, show status, and rescue motion are testable.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/outbound-messages",
    purpose: "Inspect simulated outbound policy messages the autonomous agent has already sent.",
  },
  {
    method: "POST",
    path: "/api/tenants/:tenantId/agent/run",
    purpose: "Run the autonomous sales worker to plan and execute due deal tasks immediately.",
  },
  {
    method: "POST",
    path: "/api/tenants/:tenantId/conversations/:conversationId/simulate-inbound",
    purpose: "Inject a simulated buyer message so autonomous sales policies can be tested locally.",
  },
  {
    method: "POST",
    path: "/api/tenants/:tenantId/test-lab/reset",
    purpose: "Reset the local demo tenant so repeated autonomous sales tests can start from a clean seeded state.",
  },
  {
    method: "GET",
    path: "/api/tenants/:tenantId/analytics",
    purpose: "Return reporting metrics such as coverage, response volume, and time to listing.",
  },
  {
    method: "POST",
    path: "/api/webhooks/inventory",
    purpose: "Ingest source events, validate signatures, and queue normalization work.",
  },
];
