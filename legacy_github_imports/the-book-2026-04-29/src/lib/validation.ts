import { z } from "zod";

export const tenantRouteParamsSchema = z.object({
  tenantId: z.string().min(1),
});

export const setupParentAccountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  billingEmail: z.email(),
});

export const setupDealershipSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(40),
  timezone: z.string().trim().min(2).max(80),
});

export const workspaceRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "MANAGER",
  "EMPLOYEE",
  "BILLING",
]);

export const setupChildAccountSchema = z.object({
  dealershipId: z.string().trim().min(1).optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email(),
  role: workspaceRoleSchema,
});

export const workspaceFacebookConnectionStatusSchema = z.enum([
  "CONNECTED",
  "PENDING",
  "DISCONNECTED",
]);

export const setupManualFacebookSchema = z.object({
  childAccountId: z.string().trim().min(1),
  accountLabel: z.string().trim().min(2).max(120),
  profileUrl: z.string().trim().optional().default(""),
  status: workspaceFacebookConnectionStatusSchema,
});

export const setupInventorySourceSchema = z.object({
  dealershipId: z.string().trim().min(1),
  type: z.enum(["API", "FEED", "WEBHOOK", "MANUAL"]),
  provider: z.string().trim().min(2).max(80),
  label: z.string().trim().min(2).max(120),
  status: z.enum(["CONNECTED", "DEGRADED", "DISCONNECTED", "ERROR"]),
  baseUrl: z.string().trim().max(240).default(""),
  credentialsRef: z.string().trim().max(120).optional(),
  pollIntervalMinutes: z.number().int().min(1).max(10080).optional(),
});

export const setupFacebookPageSelectionSchema = z.object({
  connectionId: z.string().trim().min(1),
  pageId: z.string().trim().min(1),
});

export const integrationConfigSchema = z.object({
  facebookAppId: z.string().trim().optional(),
  facebookAppSecret: z.string().trim().optional(),
  smtpHost: z.string().trim().optional(),
  smtpPort: z.string().trim().optional(),
  smtpSecure: z.string().trim().optional(),
  smtpUser: z.string().trim().optional(),
  smtpPassword: z.string().trim().optional(),
  smtpFrom: z.string().trim().optional(),
  generateEncryptionKey: z.boolean().optional(),
});

export const assignmentRequestSchema = z.object({
  vehicleId: z.string().min(1),
  overrideMembershipId: z.string().min(1).optional(),
  trigger: z.enum(["inventory_sync", "manual", "retry"]).default("manual"),
  reason: z.string().min(3).max(240).optional(),
});

export const inventoryQuerySchema = z.object({
  listed: z.enum(["all", "listed", "unlisted"]).optional(),
  sort: z.enum(["price", "make", "model", "daysOnLot", "mileage"]).optional(),
  employeeId: z.string().optional(),
});

export const inventoryWebhookSchema = z.object({
  deliveryId: z.string().min(1),
  sourceId: z.string().min(1),
  provider: z.string().min(1),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime(),
  vehicles: z
    .array(
      z.object({
        sourceVehicleKey: z.string().min(1),
        stockNumber: z.string().min(1),
        vin: z.string().min(10),
        status: z.string().min(1),
      }),
    )
    .min(1),
});

export const salesActorRoleSchema = z.enum(["SALESPERSON", "MANAGER", "SYSTEM"]);

export const salesDealActionSchema = z.object({
  action: z.enum([
    "BOOK_APPOINTMENT",
    "COMPLETE_APPOINTMENT",
    "SEND_TO_MANAGER",
    "SEND_QUOTE",
    "REQUEST_INFO",
    "APPROVE_FINANCE",
    "MARK_SOLD",
    "MARK_LOST",
  ]),
  actorName: z.string().trim().min(2).max(80),
  actorRole: salesActorRoleSchema,
  nextAction: z.string().trim().min(3).max(240).optional(),
  appointmentWindow: z.string().trim().min(3).max(120).optional(),
  managerHandoffReason: z.string().trim().min(3).max(240).optional(),
  paymentQuote: z.string().trim().min(3).max(160).optional(),
  lenderSummary: z.string().trim().min(3).max(240).optional(),
  lostReason: z.string().trim().min(3).max(240).optional(),
});

export const salesDealNoteSchema = z.object({
  actorName: z.string().trim().min(2).max(80),
  actorRole: salesActorRoleSchema,
  body: z.string().trim().min(3).max(500),
});

export const simulatedCustomerMessageSchema = z.object({
  body: z.string().trim().min(1).max(500),
});
