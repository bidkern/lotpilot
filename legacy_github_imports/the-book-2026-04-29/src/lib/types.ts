export const membershipRoles = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "EMPLOYEE",
  "BILLING",
] as const;

export type MembershipRole = (typeof membershipRoles)[number];

export const membershipStatuses = ["INVITED", "ACTIVE", "INACTIVE"] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];

export const socialConnectionStatuses = [
  "CONNECTED",
  "EXPIRED",
  "DISCONNECTED",
  "ERROR",
] as const;

export type SocialConnectionStatus = (typeof socialConnectionStatuses)[number];

export const vehicleLifecycleStatuses = [
  "IN_STOCK",
  "RESERVED",
  "SOLD",
  "WHOLESALE",
  "ARCHIVED",
] as const;

export type VehicleLifecycleStatus = (typeof vehicleLifecycleStatuses)[number];

export const listingStatuses = [
  "ELIGIBLE",
  "QUEUED",
  "ASSIGNED",
  "DRAFT_READY",
  "NEEDS_REVIEW",
  "POSTED",
  "FAILED",
  "ARCHIVED",
] as const;

export type ListingStatus = (typeof listingStatuses)[number];

export const listingModes = ["DIRECT_API", "HUMAN_ASSISTED"] as const;
export type ListingMode = (typeof listingModes)[number];

export const listingChannels = [
  "FACEBOOK_MARKETPLACE",
  "FACEBOOK_PAGE",
  "OTHER",
] as const;

export type ListingChannel = (typeof listingChannels)[number];

export const queueStatuses = [
  "PENDING",
  "READY",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "RETRY_SCHEDULED",
  "CANCELED",
] as const;

export type PostingQueueStatus = (typeof queueStatuses)[number];

export const queueJobTypes = [
  "INVENTORY_SYNC",
  "LISTING_ASSIGNMENT",
  "DRAFT_GENERATION",
  "PUBLISH_ATTEMPT",
  "CONVERSATION_SYNC",
  "STALE_CLEANUP",
  "NOTIFICATION_DISPATCH",
] as const;

export type QueueJobType = (typeof queueJobTypes)[number];

export const conversationStatuses = [
  "OPEN",
  "PENDING_CUSTOMER",
  "PENDING_EMPLOYEE",
  "ESCALATED",
  "CLOSED",
] as const;

export type ConversationStatus = (typeof conversationStatuses)[number];

export const messageDirections = [
  "INBOUND",
  "OUTBOUND",
  "INTERNAL_NOTE",
] as const;

export type MessageDirection = (typeof messageDirections)[number];

export interface ParentAccountSummary {
  id: string;
  name: string;
  productName: string;
  planName: string;
  seatAllowance: number;
  seatsUsed: number;
  subscriptionStatus: "ACTIVE" | "PAST_DUE" | "TRIALING";
  dealershipCount: number;
  inventorySourceLabel: string;
  listingMode: ListingMode;
}

export interface DealershipSummary {
  id: string;
  parentAccountId: string;
  name: string;
  city: string;
  state: string;
  timezone: string;
  inventorySourceStatus: "CONNECTED" | "DEGRADED" | "DISCONNECTED";
}

export interface EmployeeRecord {
  id: string;
  dealershipId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  role: MembershipRole;
  status: MembershipStatus;
  rotationPosition: number;
  facebookStatus: SocialConnectionStatus;
  liveListings: number;
  openConversations: number;
  assignmentsToday: number;
  dailyListingLimit: number;
  lastAssignedAt?: string;
  notes?: string;
}

export interface VehicleRecord {
  id: string;
  dealershipId: string;
  sourceId: string;
  stockNumber: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  priceCents: number;
  mileage: number;
  daysOnLot: number;
  lifecycleStatus: VehicleLifecycleStatus;
  listingStatus: ListingStatus;
  listedByMembershipId?: string;
  imageCount: number;
  exteriorColor: string;
  updatedAt: string;
}

export interface QueueItemRecord {
  id: string;
  vehicleId: string;
  vehicleLabel: string;
  assignedMembershipId?: string;
  scheduledFor: string;
  status: PostingQueueStatus;
  jobType: QueueJobType;
  mode: ListingMode;
  reason: string;
  retryCount: number;
}

export interface ConversationMessageRecord {
  id: string;
  direction: MessageDirection;
  body: string;
  sentAt: string;
  authorName: string;
}

export interface ConversationRecord {
  id: string;
  tenantId: string;
  vehicleId: string;
  customerName: string;
  vehicleLabel: string;
  assignedMembershipId: string;
  channel: ListingChannel;
  status: ConversationStatus;
  unreadCount: number;
  escalated: boolean;
  lastMessageAt: string;
  lastPreview: string;
  notesCount: number;
  messages: ConversationMessageRecord[];
}

export interface ActivityRecord {
  id: string;
  kind: string;
  tone: "forest" | "navy" | "tan" | "danger";
  message: string;
  createdAt: string;
}

export interface ReportMetric {
  id: string;
  label: string;
  value: string;
  change: string;
  tone: "forest" | "navy" | "tan" | "danger";
}

export interface EndpointDefinition {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  purpose: string;
}

export interface StackChoice {
  layer: string;
  selection: string;
  rationale: string;
}

export const salesDealStages = [
  "QUALIFYING",
  "VEHICLE_MATCH",
  "APPOINTMENT",
  "MANAGER_REVIEW",
  "FINANCE_READY",
  "SOLD",
  "LOST",
] as const;

export type SalesDealStage = (typeof salesDealStages)[number];

export const salesDealPriorities = ["HOT", "WARM", "STABLE"] as const;
export type SalesDealPriority = (typeof salesDealPriorities)[number];

export const appointmentStatuses = [
  "NONE",
  "PROPOSED",
  "BOOKED",
  "COMPLETED",
] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const managerPacketStatuses = [
  "NOT_READY",
  "READY",
  "QUOTE_SENT",
  "NEEDS_INFO",
  "APPROVED",
] as const;
export type ManagerPacketStatus = (typeof managerPacketStatuses)[number];

export const salesActorRoles = ["SALESPERSON", "MANAGER", "SYSTEM"] as const;
export type SalesActorRole = (typeof salesActorRoles)[number];

export const salesDealActions = [
  "BOOK_APPOINTMENT",
  "COMPLETE_APPOINTMENT",
  "SEND_TO_MANAGER",
  "SEND_QUOTE",
  "REQUEST_INFO",
  "APPROVE_FINANCE",
  "MARK_SOLD",
  "MARK_LOST",
] as const;
export type SalesDealAction = (typeof salesDealActions)[number];

export interface SalesDealNoteRecord {
  id: string;
  actorRole: SalesActorRole;
  actorName: string;
  body: string;
  createdAt: string;
}

export interface SalesDealHistoryRecord {
  id: string;
  actorRole: SalesActorRole;
  actorName: string;
  event: string;
  message: string;
  createdAt: string;
}

export interface SalesDealRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  customerName: string;
  vehicleId: string;
  vehicleLabel: string;
  salespersonId: string;
  managerId: string;
  stage: SalesDealStage;
  priority: SalesDealPriority;
  buyerIntent:
    | "availability"
    | "finance"
    | "appointment"
    | "feature_walkthrough";
  buyerGoal: string;
  objection: string;
  nextAction: string;
  suggestedReply: string;
  financeSummary: string;
  tradePrompt: string;
  backupVehicleId?: string;
  appointmentWindow?: string;
  appointmentStatus: AppointmentStatus;
  managerPacketStatus: ManagerPacketStatus;
  managerHandoffReason?: string;
  paymentQuote?: string;
  lenderSummary?: string;
  lostReason?: string;
  notes: SalesDealNoteRecord[];
  history: SalesDealHistoryRecord[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export const agentTaskKinds = [
  "SAFE_REPLY",
  "FOLLOW_UP",
  "BOOK_APPOINTMENT",
  "APPOINTMENT_CONFIRMATION",
  "APPOINTMENT_NO_SHOW_CHECK",
  "CREATE_MANAGER_PACKET",
  "MANAGER_AUTO_APPROVAL",
] as const;
export type AgentTaskKind = (typeof agentTaskKinds)[number];

export const agentTaskStatuses = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const;
export type AgentTaskStatus = (typeof agentTaskStatuses)[number];

export interface AgentTaskRecord {
  id: string;
  tenantId: string;
  dealId: string;
  conversationId: string;
  kind: AgentTaskKind;
  status: AgentTaskStatus;
  title: string;
  reason: string;
  scheduledFor: string;
  attemptCount: number;
  followUpStep?: number;
  messageDraft?: string;
  appointmentWindow?: string;
  managerReason?: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export const outboundMessagePolicyIds = [
  "SAFE_REPLY",
  "FOLLOW_UP",
  "APPOINTMENT_BOOKED",
  "APPOINTMENT_CONFIRMATION",
  "APPOINTMENT_NO_SHOW",
  "MANAGER_PACKET_STARTED",
  "MANAGER_AUTO_APPROVED",
] as const;
export type OutboundMessagePolicyId = (typeof outboundMessagePolicyIds)[number];

export interface OutboundMessageRecord {
  id: string;
  tenantId: string;
  dealId: string;
  conversationId: string;
  policyId: OutboundMessagePolicyId;
  channel: ListingChannel;
  actorName: string;
  body: string;
  deliveryStatus: "SIMULATED_SENT";
  sentAt: string;
  createdAt: string;
}

export const salesAppointmentStatuses = [
  "BOOKED",
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELED",
] as const;
export type SalesAppointmentStatus = (typeof salesAppointmentStatuses)[number];

export interface SalesAppointmentRecord {
  id: string;
  tenantId: string;
  dealId: string;
  conversationId: string;
  customerName: string;
  vehicleLabel: string;
  windowLabel: string;
  scheduledAt: string;
  endsAt: string;
  status: SalesAppointmentStatus;
  confirmationSentAt?: string;
  confirmedAt?: string;
  completedAt?: string;
  noShowRecordedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWorkerSummary {
  tenantId: string;
  startedAt: string;
  completedAt: string;
  scannedDeals: number;
  scheduledTasks: number;
  executedTasks: number;
  sentMessages: number;
  bookedAppointments: number;
  appointmentRemindersSent: number;
  noShowsMarked: number;
  managerPacketsCreated: number;
  autoApprovedPackets: number;
  followUpsScheduled: number;
  notes: string[];
}
