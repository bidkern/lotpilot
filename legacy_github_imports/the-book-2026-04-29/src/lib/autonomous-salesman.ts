import {
  activityFeed,
  conversations,
  dealerships,
  employees,
  nextRotationDecision,
  parentAccount,
  queueItems,
  vehicles,
} from "@/lib/demo-data";
import type {
  ActivityRecord,
  ConversationRecord,
  EmployeeRecord,
  SalesDealPriority,
  SalesDealRecord,
  SalesDealStage,
  VehicleRecord,
} from "@/lib/types";

type BadgeTone = "forest" | "navy" | "tan" | "danger" | "slate";
type LeadIntent = SalesDealRecord["buyerIntent"];

interface StagePresentation {
  label: string;
  tone: BadgeTone;
  appointmentReady: boolean;
  managerReady: boolean;
}

export interface SalesDealBrief {
  id: string;
  customerName: string;
  vehicleLabel: string;
  ownerName: string;
  managerName: string;
  stageLabel: string;
  stageTone: BadgeTone;
  priorityLabel: string;
  priorityTone: BadgeTone;
  buyerGoal: string;
  objection: string;
  nextAction: string;
  suggestedReply: string;
  financeSummary: string;
  tradePrompt: string;
  appointmentStatusLabel: string;
  managerPacketLabel: string;
  managerPacketTone: BadgeTone;
  backupVehicleLabel?: string;
  appointmentWindow?: string;
  managerHandoffReason?: string;
  paymentQuote?: string;
  lenderSummary?: string;
  lostReason?: string;
  noteCount: number;
  isClosed: boolean;
  lastUpdatedAt: string;
}

export interface ManagerHandoffBrief {
  id: string;
  dealId: string;
  customerName: string;
  vehicleLabel: string;
  ownerName: string;
  managerName: string;
  reason: string;
  packetLabel: string;
  packetTone: BadgeTone;
  handoffAction: string;
  notes: string;
}

export interface InventoryPlay {
  id: string;
  vehicleLabel: string;
  ownerName: string;
  fitLabel: string;
  action: string;
  reason: string;
  tone: BadgeTone;
  priceCents: number;
}

export interface WorkflowStep {
  id: string;
  title: string;
  detail: string;
  tone: BadgeTone;
}

export interface SalesFloorSnapshot {
  parentAccountName: string;
  inventoryCount: number;
  liveLeadCount: number;
  qualifiedBuyerCount: number;
  hotLeadCount: number;
  unreadLeadCount: number;
  appointmentReadyCount: number;
  financeHandoffCount: number;
  soldDealCount: number;
  needsManagerCount: number;
  needsMoreInfoCount: number;
  deskManagerName: string;
  nextAssignmentSummary: string;
  humanGuardrailSummary: string;
  salesFloorSummary: string;
  heroTitle: string;
  heroSummary: string;
  dealBriefs: SalesDealBrief[];
  managerHandoffs: ManagerHandoffBrief[];
  inventoryPlays: InventoryPlay[];
  workflowSteps: WorkflowStep[];
  activityFeed: ActivityRecord[];
}

export interface SalesFloorState {
  tenantId: string;
  snapshot: SalesFloorSnapshot;
  deals: SalesDealRecord[];
  employees: EmployeeRecord[];
  vehicles: VehicleRecord[];
  conversations: ConversationRecord[];
}

export const DEFAULT_SALES_TENANT_ID =
  dealerships[0]?.id || "tenant_sales_floor";

export function createSeedSalesConversations(
  tenantId = DEFAULT_SALES_TENANT_ID,
) {
  return conversations.map((conversation) => ({
    ...structuredClone(conversation),
    tenantId,
  }));
}

const truckKeywords = [
  "f-150",
  "silverado",
  "sierra",
  "ram",
  "tacoma",
  "frontier",
] as const;
const suvKeywords = ["cr-v", "grand cherokee", "outback"] as const;

function buildEmployeeNameById(records: EmployeeRecord[]) {
  return Object.fromEntries(
    records.map((employee) => [employee.id, employee.displayName]),
  );
}

function getVehicleSegment(vehicle: VehicleRecord) {
  const haystack = `${vehicle.make} ${vehicle.model} ${vehicle.trim}`.toLowerCase();

  if (truckKeywords.some((keyword) => haystack.includes(keyword))) {
    return "truck";
  }

  if (suvKeywords.some((keyword) => haystack.includes(keyword))) {
    return "suv";
  }

  return "car";
}

function getIntent(conversation: ConversationRecord): LeadIntent {
  const haystack = [
    conversation.lastPreview,
    ...conversation.messages.map((message) => message.body),
  ]
    .join(" ")
    .toLowerCase();

  if (
    haystack.includes("best price") ||
    haystack.includes("finance") ||
    haystack.includes("payment")
  ) {
    return "finance";
  }

  if (
    haystack.includes("test drive") ||
    haystack.includes("schedule") ||
    haystack.includes("appointment")
  ) {
    return "appointment";
  }

  if (haystack.includes("available") || haystack.includes("still")) {
    return "availability";
  }

  return "feature_walkthrough";
}

function getPriorityScore(conversation: ConversationRecord, intent: LeadIntent) {
  const score =
    36 +
    conversation.unreadCount * 12 +
    (conversation.escalated ? 22 : 0) +
    (conversation.status === "PENDING_EMPLOYEE" ? 10 : 0) +
    (intent === "finance" ? 14 : 0) +
    (intent === "appointment" ? 11 : 0) +
    (intent === "availability" ? 8 : 0);

  return Math.min(score, 98);
}

function getPriority(score: number): SalesDealPriority {
  if (score >= 78) {
    return "HOT";
  }

  if (score >= 62) {
    return "WARM";
  }

  return "STABLE";
}

function getPriorityPresentation(priority: SalesDealPriority) {
  switch (priority) {
    case "HOT":
      return { label: "Hot", tone: "danger" as const };
    case "WARM":
      return { label: "Warm", tone: "tan" as const };
    default:
      return { label: "Stable", tone: "forest" as const };
  }
}

function getStageFromConversation(
  intent: LeadIntent,
  conversation: ConversationRecord,
): SalesDealStage {
  if (intent === "finance" && conversation.escalated) {
    return "MANAGER_REVIEW";
  }

  if (intent === "appointment") {
    return "APPOINTMENT";
  }

  if (intent === "feature_walkthrough" || intent === "finance") {
    return "VEHICLE_MATCH";
  }

  return "QUALIFYING";
}

function getStagePresentation(deal: SalesDealRecord): StagePresentation {
  switch (deal.stage) {
    case "QUALIFYING":
      return {
        label: "Buyer qualifying",
        tone: "navy",
        appointmentReady: false,
        managerReady: false,
      };
    case "VEHICLE_MATCH":
      return {
        label: "Vehicle match",
        tone: "navy",
        appointmentReady: false,
        managerReady: false,
      };
    case "APPOINTMENT":
      return {
        label:
          deal.appointmentStatus === "BOOKED"
            ? "Appointment booked"
            : "Appointment working",
        tone: "forest",
        appointmentReady: true,
        managerReady: deal.managerPacketStatus !== "NOT_READY",
      };
    case "MANAGER_REVIEW":
      return {
        label: "Manager review",
        tone:
          deal.managerPacketStatus === "NEEDS_INFO" ? "tan" : "danger",
        appointmentReady: deal.appointmentStatus === "BOOKED",
        managerReady: true,
      };
    case "FINANCE_READY":
      return {
        label: "Finance ready",
        tone: "danger",
        appointmentReady: deal.appointmentStatus === "BOOKED",
        managerReady: true,
      };
    case "SOLD":
      return {
        label: "Sold",
        tone: "forest",
        appointmentReady: false,
        managerReady: false,
      };
    case "LOST":
      return {
        label: "Lost",
        tone: "slate",
        appointmentReady: false,
        managerReady: false,
      };
  }
}

function getAppointmentStatusLabel(deal: SalesDealRecord) {
  switch (deal.appointmentStatus) {
    case "PROPOSED":
      return "Window proposed";
    case "BOOKED":
      return "Visit booked";
    case "COMPLETED":
      return "Visit completed";
    default:
      return "No visit yet";
  }
}

function getManagerPacketPresentation(
  status: SalesDealRecord["managerPacketStatus"],
) {
  switch (status) {
    case "READY":
      return { label: "Packet ready", tone: "danger" as const };
    case "QUOTE_SENT":
      return { label: "Quote sent", tone: "navy" as const };
    case "NEEDS_INFO":
      return { label: "Needs info", tone: "tan" as const };
    case "APPROVED":
      return { label: "Approved", tone: "forest" as const };
    default:
      return { label: "Discovery running", tone: "slate" as const };
  }
}

function getBuyerGoal(intent: LeadIntent, vehicle: VehicleRecord | undefined) {
  const segment = vehicle ? getVehicleSegment(vehicle) : "car";

  switch (intent) {
    case "availability":
      return "Needs confidence the vehicle is real, available, and worth making time for.";
    case "finance":
      return "Wants the deal structure, payment comfort, and urgency handled today.";
    case "appointment":
      return "Already leaning toward an in-person drive and wants a reserved slot.";
    default:
      return segment === "truck"
        ? "Needs proof this truck fits work or towing life before committing."
        : "Needs proof the vehicle fits lifestyle and feature expectations.";
  }
}

function getObjection(intent: LeadIntent) {
  switch (intent) {
    case "availability":
      return "Trust and certainty are the blocker right now.";
    case "finance":
      return "Price and payment clarity are the blocker right now.";
    case "appointment":
      return "Scheduling certainty is the blocker right now.";
    default:
      return "Product fit is the blocker right now.";
  }
}

function getBackupVehicle(
  currentVehicle: VehicleRecord | undefined,
  intent: LeadIntent,
) {
  if (!currentVehicle || intent === "finance") {
    return undefined;
  }

  const segment = getVehicleSegment(currentVehicle);

  return [...vehicles]
    .filter(
      (vehicle) =>
        vehicle.id !== currentVehicle.id &&
        vehicle.lifecycleStatus === "IN_STOCK" &&
        getVehicleSegment(vehicle) === segment,
    )
    .sort((left, right) => left.daysOnLot - right.daysOnLot)[0];
}

function getTradePrompt(vehicle: VehicleRecord | undefined) {
  if (!vehicle) {
    return "Ask whether there is a trade before pricing gets serious.";
  }

  switch (getVehicleSegment(vehicle)) {
    case "truck":
      return "Ask whether they are replacing another truck and collect payoff or trade details.";
    case "suv":
      return "Ask whether they are moving out of another family SUV to shape payment comparison.";
    default:
      return "Ask about a current vehicle so the desk can frame trade and payment options together.";
  }
}

function getFinanceSummary(
  intent: LeadIntent,
  conversation: ConversationRecord,
) {
  if (intent === "finance" && conversation.escalated) {
    return "Finance intent is clear. The desk packet should include payment target, lender comfort, and down-payment range.";
  }

  if (intent === "finance") {
    return "Collect down-payment comfort and lender preference before pulling the manager in.";
  }

  if (intent === "appointment") {
    return "Lock the appointment first, then offer a soft payment preview before arrival.";
  }

  return "Financing is not the current blocker, but you should still discover trade and payment comfort early.";
}

function getAppointmentWindow(intent: LeadIntent) {
  switch (intent) {
    case "availability":
      return "Tomorrow at 10:00 AM or 12:30 PM";
    case "appointment":
      return "Saturday at 10:00 AM or 1:15 PM";
    default:
      return undefined;
  }
}

function getManagerHandoffReason(
  intent: LeadIntent,
  conversation: ConversationRecord,
) {
  if (intent === "finance" && conversation.escalated) {
    return "Buyer is asking for pricing and finance structure today.";
  }

  if (intent === "appointment") {
    return "Prep the desk before the visit lands so numbers are ready if the test drive converts.";
  }

  return undefined;
}

function getNextAction(
  intent: LeadIntent,
  conversation: ConversationRecord,
  appointmentWindow: string | undefined,
) {
  switch (intent) {
    case "availability":
      return `Confirm the unit is physically available, then offer ${appointmentWindow || "two held arrival windows"}.`;
    case "finance":
      return conversation.escalated
        ? "Keep the buyer warm, collect down-payment comfort, and move the manager into the thread fast."
        : "Qualify budget, lender comfort, and trade status before asking the desk for numbers.";
    case "appointment":
      return `Reserve ${appointmentWindow || "a firm drive window"} and get commitment language back from the buyer.`;
    default:
      return "Answer the product objection clearly, then ask for a visit or walkaround-video commitment.";
  }
}

function getSuggestedReply(
  intent: LeadIntent,
  backupVehicle: VehicleRecord | undefined,
  appointmentWindow: string | undefined,
) {
  switch (intent) {
    case "availability":
      return `Yes, it is here and available. I can hold ${appointmentWindow || "two visit windows"} for you so you are not driving over blind. Which one works better?`;
    case "finance":
      return "Absolutely. I can help with the numbers today. If you give me a rough down payment and whether you are financing through your own bank or ours, I can bring my manager in with a clean structure.";
    case "appointment":
      return `Yes. I can reserve ${appointmentWindow || "a firm test-drive slot"} for you now, and I will have the vehicle pulled up front before you arrive.`;
    default:
      return backupVehicle
        ? `It does. I can send a quick walkaround that shows that feature, and I also have a ${backupVehicle.year} ${backupVehicle.make} ${backupVehicle.model} if you want a second option to compare.`
        : "It does. I can send a quick walkaround showing that feature, and if it looks right I can lock in a visit time for you.";
  }
}

function getOwnerName(
  vehicle: VehicleRecord,
  employeeNameById: Record<string, string>,
) {
  const queuedAssignment = queueItems.find((item) => item.vehicleId === vehicle.id);
  const assignedEmployeeId =
    vehicle.listedByMembershipId || queuedAssignment?.assignedMembershipId;

  if (assignedEmployeeId) {
    return employeeNameById[assignedEmployeeId] || "Sales team";
  }

  if (nextRotationDecision.status === "ASSIGNED" && nextRotationDecision.employee) {
    return nextRotationDecision.employee.displayName;
  }

  return "Manager review";
}

function scoreInventoryPlay(vehicle: VehicleRecord) {
  return (
    vehicle.daysOnLot * 2 +
    (vehicle.listingStatus === "QUEUED" ? 30 : 0) +
    (vehicle.listingStatus === "ELIGIBLE" ? 24 : 0) +
    (vehicle.listingStatus === "DRAFT_READY" ? 22 : 0) +
    (vehicle.listingStatus === "NEEDS_REVIEW" ? 16 : 0) +
    (vehicle.listingStatus === "POSTED" ? -28 : 0)
  );
}

function describeInventoryPlay(vehicle: VehicleRecord) {
  switch (vehicle.listingStatus) {
    case "QUEUED":
      return {
        fitLabel: "Value truck",
        action: "Use this as a payment-first truck story for shoppers who need value and utility.",
        reason: `${vehicle.daysOnLot} days on lot means this unit should be part of active buyer conversations now, not later.`,
        tone: "danger" as const,
      };
    case "ELIGIBLE":
      return {
        fitLabel: "Alternative match",
        action: "Keep this ready as the next best half-ton alternative when a buyer objects on trim or price.",
        reason: "Fresh alternative inventory lets the salesperson save the conversation instead of losing the buyer.",
        tone: "navy" as const,
      };
    case "DRAFT_READY":
      return {
        fitLabel: "Payment sedan",
        action: "Pair this sedan with buyers who care more about payment comfort than showroom flash.",
        reason: "The listing is close enough to ready that this unit can support a strong payment-led pitch immediately.",
        tone: "forest" as const,
      };
    case "NEEDS_REVIEW":
      return {
        fitLabel: "Recoverable demand",
        action: "Fix the blocker fast so this unit can re-enter the selling set for feature-focused buyers.",
        reason: "There is demand here, but the vehicle is leaking momentum because the presentation is incomplete.",
        tone: "tan" as const,
      };
    default:
      return {
        fitLabel: "Backup option",
        action: "Keep this unit loaded as a backup when the first-choice objection is price or feature fit.",
        reason: "A strong salesperson always has a second vehicle ready before the buyer goes quiet.",
        tone: "forest" as const,
      };
  }
}

function deriveHistoryTone(message: string): ActivityRecord["tone"] {
  const haystack = message.toLowerCase();

  if (
    haystack.includes("sold") ||
    haystack.includes("approved") ||
    haystack.includes("booked")
  ) {
    return "forest";
  }

  if (haystack.includes("manager") || haystack.includes("quote")) {
    return "danger";
  }

  if (haystack.includes("info") || haystack.includes("lost")) {
    return "tan";
  }

  return "navy";
}

function priorityRank(priority: SalesDealPriority) {
  switch (priority) {
    case "HOT":
      return 3;
    case "WARM":
      return 2;
    default:
      return 1;
  }
}

function stageRank(stage: SalesDealStage) {
  switch (stage) {
    case "MANAGER_REVIEW":
      return 6;
    case "FINANCE_READY":
      return 5;
    case "APPOINTMENT":
      return 4;
    case "VEHICLE_MATCH":
      return 3;
    case "QUALIFYING":
      return 2;
    case "SOLD":
      return 1;
    case "LOST":
      return 0;
  }
}

function getDeskManagerName() {
  return (
    employees.find(
      (employee) => employee.role === "MANAGER" && employee.status === "ACTIVE",
    )?.displayName || "Desk manager"
  );
}

export function createSeedSalesDeals(
  tenantId = DEFAULT_SALES_TENANT_ID,
  conversationRecords = createSeedSalesConversations(tenantId),
): SalesDealRecord[] {
  const deskManagerName = getDeskManagerName();
  const vehicleById = Object.fromEntries(
    vehicles.map((vehicle) => [vehicle.id, vehicle]),
  );

  return conversationRecords.map((conversation) => {
    const intent = getIntent(conversation);
    const currentVehicle = vehicleById[conversation.vehicleId];
    const backupVehicle = getBackupVehicle(currentVehicle, intent);
    const priority = getPriority(getPriorityScore(conversation, intent));
    const stage = getStageFromConversation(intent, conversation);
    const appointmentWindow = getAppointmentWindow(intent);
    const managerHandoffReason = getManagerHandoffReason(intent, conversation);
    const createdAt = conversation.messages[0]?.sentAt || conversation.lastMessageAt;

    const seededHistory = [
      {
        id: `history_created_${conversation.id}`,
        actorRole: "SYSTEM" as const,
        actorName: "Sales floor autopilot",
        event: "DEAL_CREATED",
        message: `Deal record opened from the ${conversation.customerName} conversation.`,
        createdAt,
      },
      ...(managerHandoffReason
        ? [
            {
              id: `history_manager_${conversation.id}`,
              actorRole: "SYSTEM" as const,
              actorName: "Sales floor autopilot",
              event: "MANAGER_SIGNAL",
              message: `Manager packet flagged for ${deskManagerName}.`,
              createdAt: conversation.lastMessageAt,
            },
          ]
        : []),
    ];

    return {
      id: `deal_${conversation.id}`,
      tenantId,
      conversationId: conversation.id,
      customerName: conversation.customerName,
      vehicleId: conversation.vehicleId,
      vehicleLabel: conversation.vehicleLabel,
      salespersonId: conversation.assignedMembershipId,
      managerId:
        employees.find((employee) => employee.role === "MANAGER")?.id ||
        conversation.assignedMembershipId,
      stage,
      priority,
      buyerIntent: intent,
      buyerGoal: getBuyerGoal(intent, currentVehicle),
      objection: getObjection(intent),
      nextAction: getNextAction(intent, conversation, appointmentWindow),
      suggestedReply: getSuggestedReply(intent, backupVehicle, appointmentWindow),
      financeSummary: getFinanceSummary(intent, conversation),
      tradePrompt: getTradePrompt(currentVehicle),
      backupVehicleId: backupVehicle?.id,
      appointmentWindow,
      appointmentStatus:
        intent === "appointment"
          ? "PROPOSED"
          : appointmentWindow
            ? "PROPOSED"
            : "NONE",
      managerPacketStatus:
        stage === "MANAGER_REVIEW"
          ? "READY"
          : managerHandoffReason
            ? "READY"
            : "NOT_READY",
      managerHandoffReason,
      notes: conversation.messages
        .filter((message) => message.direction === "INTERNAL_NOTE")
        .map((message, index) => ({
          id: `note_${conversation.id}_${index + 1}`,
          actorRole: "SALESPERSON" as const,
          actorName: message.authorName,
          body: message.body,
          createdAt: message.sentAt,
        })),
      history: seededHistory,
      createdAt,
      updatedAt: conversation.lastMessageAt,
    };
  });
}

function buildInventoryPlays() {
  const employeeNameById = buildEmployeeNameById(employees);

  return [...vehicles]
    .sort((left, right) => scoreInventoryPlay(right) - scoreInventoryPlay(left))
    .slice(0, 4)
    .map((vehicle) => {
      const description = describeInventoryPlay(vehicle);

      return {
        id: vehicle.id,
        vehicleLabel: `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`,
        ownerName: getOwnerName(vehicle, employeeNameById),
        fitLabel: description.fitLabel,
        action: description.action,
        reason: description.reason,
        tone: description.tone,
        priceCents: vehicle.priceCents,
      };
    });
}

export function buildSalesFloorState(
  deals: SalesDealRecord[],
  tenantId = DEFAULT_SALES_TENANT_ID,
  conversationRecords = createSeedSalesConversations(tenantId),
): SalesFloorState {
  const employeeNameById = buildEmployeeNameById(employees);
  const vehicleById = Object.fromEntries(
    vehicles.map((vehicle) => [vehicle.id, vehicle]),
  );
  const tenantConversations = conversationRecords.filter(
    (conversation) => conversation.tenantId === tenantId,
  );
  const conversationById = Object.fromEntries(
    tenantConversations.map((conversation) => [conversation.id, conversation]),
  );
  const deskManagerName = getDeskManagerName();
  const tenantDeals = [...deals]
    .filter((deal) => deal.tenantId === tenantId)
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
  const activeDeals = tenantDeals.filter(
    (deal) => deal.stage !== "SOLD" && deal.stage !== "LOST",
  );

  const dealBriefs = [...tenantDeals]
    .sort((left, right) => {
      const priorityDelta = priorityRank(right.priority) - priorityRank(left.priority);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const stageDelta = stageRank(right.stage) - stageRank(left.stage);

      if (stageDelta !== 0) {
        return stageDelta;
      }

      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })
    .map((deal) => {
      const stage = getStagePresentation(deal);
      const priority = getPriorityPresentation(deal.priority);
      const managerPacket = getManagerPacketPresentation(deal.managerPacketStatus);
      const currentVehicle = vehicleById[deal.vehicleId];
      const backupVehicle = deal.backupVehicleId
        ? vehicleById[deal.backupVehicleId]
        : undefined;

      return {
        id: deal.id,
        customerName: deal.customerName,
        vehicleLabel: deal.vehicleLabel,
        ownerName: employeeNameById[deal.salespersonId] || "Sales team",
        managerName: employeeNameById[deal.managerId] || deskManagerName,
        stageLabel: stage.label,
        stageTone: stage.tone,
        priorityLabel: priority.label,
        priorityTone: priority.tone,
        buyerGoal: deal.buyerGoal,
        objection: deal.objection,
        nextAction: deal.nextAction,
        suggestedReply: deal.suggestedReply,
        financeSummary: deal.financeSummary,
        tradePrompt: deal.tradePrompt || getTradePrompt(currentVehicle),
        appointmentStatusLabel: getAppointmentStatusLabel(deal),
        managerPacketLabel: managerPacket.label,
        managerPacketTone: managerPacket.tone,
        backupVehicleLabel: backupVehicle
          ? `${backupVehicle.year} ${backupVehicle.make} ${backupVehicle.model}`
          : undefined,
        appointmentWindow: deal.appointmentWindow,
        managerHandoffReason: deal.managerHandoffReason,
        paymentQuote: deal.paymentQuote,
        lenderSummary: deal.lenderSummary,
        lostReason: deal.lostReason,
        noteCount: deal.notes.length,
        isClosed: deal.stage === "SOLD" || deal.stage === "LOST",
        lastUpdatedAt: deal.updatedAt,
      };
    });

  const qualifiedBuyerCount = activeDeals.length;
  const hotLeadCount = activeDeals.filter((deal) => deal.priority === "HOT").length;
  const unreadLeadCount = activeDeals.reduce((total, deal) => {
    return total + (conversationById[deal.conversationId]?.unreadCount || 0);
  }, 0);
  const appointmentReadyCount = activeDeals.filter((deal) => {
    const stage = getStagePresentation(deal);
    return stage.appointmentReady;
  }).length;
  const financeHandoffCount = activeDeals.filter(
    (deal) => deal.managerPacketStatus !== "NOT_READY",
  ).length;
  const soldDealCount = tenantDeals.filter((deal) => deal.stage === "SOLD").length;
  const needsManagerCount = activeDeals.filter(
    (deal) =>
      deal.stage === "MANAGER_REVIEW" || deal.stage === "FINANCE_READY",
  ).length;
  const needsMoreInfoCount = activeDeals.filter(
    (deal) => deal.managerPacketStatus === "NEEDS_INFO",
  ).length;

  const managerHandoffs = activeDeals
    .filter((deal) => deal.managerPacketStatus !== "NOT_READY")
    .map((deal) => {
      const managerPacket = getManagerPacketPresentation(deal.managerPacketStatus);
      const ownerName = employeeNameById[deal.salespersonId] || "Sales team";
      const managerName = employeeNameById[deal.managerId] || deskManagerName;

      return {
        id: `handoff_${deal.id}`,
        dealId: deal.id,
        customerName: deal.customerName,
        vehicleLabel: deal.vehicleLabel,
        ownerName,
        managerName,
        reason:
          deal.managerHandoffReason ||
          "Manager review is needed before the buyer loses momentum.",
        packetLabel: managerPacket.label,
        packetTone: managerPacket.tone,
        handoffAction:
          deal.managerPacketStatus === "QUOTE_SENT"
            ? "Follow up on the quote fit and tighten the next appointment or delivery step."
            : deal.managerPacketStatus === "NEEDS_INFO"
              ? "Collect missing trade, lender, or down-payment details so the desk can finish the structure."
              : deal.managerPacketStatus === "APPROVED"
                ? "Keep the buyer moving and close the visit or delivery path while finance is green."
                : `${managerName} should return a payment path while ${ownerName} keeps control of the relationship.`,
        notes:
          deal.lenderSummary ||
          deal.paymentQuote ||
          `${ownerName} already has buyer momentum. Keep the salesperson leading while the desk handles numbers.`,
      };
    })
    .sort((left, right) => left.customerName.localeCompare(right.customerName));

  const inventoryPlays = buildInventoryPlays();

  const derivedActivity = tenantDeals
    .flatMap((deal) =>
      deal.history.map((entry) => ({
        id: entry.id,
        kind: entry.event.toLowerCase(),
        tone: deriveHistoryTone(entry.message),
        message: `${deal.customerName}: ${entry.message}`,
        createdAt: entry.createdAt,
      })),
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 5);

  const combinedActivity = [...derivedActivity, ...activityFeed]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 6);

  const workflowSteps: WorkflowStep[] = [
    {
      id: "qualify",
      title: "Qualify the buyer",
      detail: `${qualifiedBuyerCount} live deals are still in motion on the floor.`,
      tone: hotLeadCount > 0 ? "forest" : "navy",
    },
    {
      id: "fit",
      title: "Frame the right vehicle",
      detail: `${inventoryPlays.length} backup units stay ready so objections do not kill the conversation.`,
      tone: "navy",
    },
    {
      id: "appointment",
      title: "Lock the visit",
      detail:
        appointmentReadyCount > 0
          ? `${appointmentReadyCount} deals have a visit lane working right now.`
          : "No deals have a visit lane working yet.",
      tone: appointmentReadyCount > 0 ? "forest" : "tan",
    },
    {
      id: "desk",
      title: "Desk and finance handoff",
      detail:
        financeHandoffCount > 0
          ? `${financeHandoffCount} deals are mature enough for pricing, structuring, or final approval.`
          : "No deals are at the desk yet.",
      tone: financeHandoffCount > 0 ? "danger" : "navy",
    },
  ];

  const nextAssignmentSummary =
    nextRotationDecision.status === "ASSIGNED" && nextRotationDecision.employee
      ? `${nextRotationDecision.employee.displayName} is next up when a fresh buyer needs coverage or an alternative unit.`
      : "Rotation is blocked, so a manager needs to assign the next buyer path by hand.";

  const humanGuardrailSummary =
    parentAccount.listingMode === "HUMAN_ASSISTED"
      ? "The system can qualify, match, follow up, and prep the desk handoff while final pricing and finance decisions stay visible with humans."
      : "Direct publishing is enabled only for supported official channels.";

  const snapshot: SalesFloorSnapshot = {
    parentAccountName: parentAccount.name,
    inventoryCount: vehicles.length,
    liveLeadCount: activeDeals.length,
    qualifiedBuyerCount,
    hotLeadCount,
    unreadLeadCount,
    appointmentReadyCount,
    financeHandoffCount,
    soldDealCount,
    needsManagerCount,
    needsMoreInfoCount,
    deskManagerName,
    nextAssignmentSummary,
    humanGuardrailSummary,
    salesFloorSummary: `${qualifiedBuyerCount} buyers in play, ${financeHandoffCount} manager packets working, and ${soldDealCount} completed deals already tracked in the ledger.`,
    heroTitle:
      "An autonomous salesperson that can work the buyer all the way to a real manager handoff.",
    heroSummary: `${parentAccount.name} is not just reducing dealership overhead. It is running discovery, vehicle matching, appointment-setting, quote prep, and deal-state tracking so the desk only touches mature opportunities.`,
    dealBriefs,
    managerHandoffs,
    inventoryPlays,
    workflowSteps,
    activityFeed: combinedActivity,
  };

  return {
    tenantId,
    snapshot,
    deals: tenantDeals,
    employees,
    vehicles,
    conversations: tenantConversations,
  };
}

export const autonomousSalesmanState = buildSalesFloorState(
  createSeedSalesDeals(DEFAULT_SALES_TENANT_ID),
  DEFAULT_SALES_TENANT_ID,
  createSeedSalesConversations(DEFAULT_SALES_TENANT_ID),
);

export const autonomousSalesmanSnapshot = autonomousSalesmanState.snapshot;
