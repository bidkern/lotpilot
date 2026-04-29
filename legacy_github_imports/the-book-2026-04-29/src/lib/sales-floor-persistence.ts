import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildSalesFloorState,
  createSeedSalesConversations,
  createSeedSalesDeals,
  type SalesFloorState,
} from "@/lib/autonomous-salesman";
import type {
  ConversationMessageRecord,
  ConversationRecord,
  MessageDirection,
  SalesActorRole,
  SalesDealAction,
  SalesDealRecord,
} from "@/lib/types";

const DATA_DIRECTORY = path.join(process.cwd(), "runtime-data");
const DATA_FILE = path.join(DATA_DIRECTORY, "live-sales-deals.json");

interface SalesFloorDocument {
  version: 2;
  deals: SalesDealRecord[];
  conversations: ConversationRecord[];
  updatedAt: string;
}

export interface SalesDealActionInput {
  action: SalesDealAction;
  actorName: string;
  actorRole: SalesActorRole;
  nextAction?: string;
  appointmentWindow?: string;
  managerHandoffReason?: string;
  paymentQuote?: string;
  lenderSummary?: string;
  lostReason?: string;
}

export interface SalesDealNoteInput {
  actorName: string;
  actorRole: SalesActorRole;
  body: string;
}

export interface SalesFloorConversationMessageInput {
  direction: MessageDirection;
  authorName: string;
  body: string;
  sentAt?: string;
}

function createDefaultDocument(): SalesFloorDocument {
  return {
    version: 2,
    deals: [],
    conversations: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDocument(document: Partial<SalesFloorDocument> | null) {
  const baseDocument = createDefaultDocument();

  if (!document || typeof document !== "object") {
    return baseDocument;
  }

  return {
    version: 2 as const,
    deals: Array.isArray(document.deals) ? document.deals : [],
    conversations: Array.isArray(document.conversations)
      ? document.conversations
      : [],
    updatedAt: document.updatedAt ?? baseDocument.updatedAt,
  };
}

async function ensureDocumentFile() {
  await mkdir(DATA_DIRECTORY, { recursive: true });

  try {
    await readFile(DATA_FILE, "utf8");
  } catch {
    await writeFile(DATA_FILE, JSON.stringify(createDefaultDocument(), null, 2), "utf8");
  }
}

async function readDocument() {
  await ensureDocumentFile();

  try {
    const rawDocument = await readFile(DATA_FILE, "utf8");
    const parsedDocument = JSON.parse(rawDocument) as Partial<SalesFloorDocument>;
    return normalizeDocument(parsedDocument);
  } catch {
    const fallbackDocument = createDefaultDocument();
    await writeDocument(fallbackDocument);
    return fallbackDocument;
  }
}

async function writeDocument(document: SalesFloorDocument) {
  const normalizedDocument = normalizeDocument({
    ...document,
    updatedAt: new Date().toISOString(),
  });

  await ensureDocumentFile();
  await writeFile(DATA_FILE, JSON.stringify(normalizedDocument, null, 2), "utf8");

  return normalizedDocument;
}

let documentQueue = Promise.resolve();

async function withDocumentLock<T>(
  callback: (document: SalesFloorDocument) => Promise<T> | T,
) {
  const run = documentQueue.then(async () => {
    const document = await readDocument();
    return callback(document);
  });

  documentQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

function trimOptional(value: string | undefined) {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function getTenantConversations(document: SalesFloorDocument, tenantId: string) {
  return document.conversations.filter((conversation) => conversation.tenantId === tenantId);
}

function ensureTenantSeeded(document: SalesFloorDocument, tenantId: string) {
  let seeded = false;

  if (!document.conversations.some((conversation) => conversation.tenantId === tenantId)) {
    document.conversations = [
      ...document.conversations,
      ...createSeedSalesConversations(tenantId),
    ];
    seeded = true;
  }

  if (!document.deals.some((deal) => deal.tenantId === tenantId)) {
    const tenantConversations = getTenantConversations(document, tenantId);

    document.deals = [
      ...document.deals,
      ...createSeedSalesDeals(tenantId, tenantConversations),
    ];
    seeded = true;
  }

  return seeded;
}

function requireDeal(
  document: SalesFloorDocument,
  tenantId: string,
  dealId: string,
) {
  const deal = document.deals.find(
    (item) => item.tenantId === tenantId && item.id === dealId,
  );

  if (!deal) {
    throw new Error("Deal record not found.");
  }

  return deal;
}

function requireConversation(
  document: SalesFloorDocument,
  tenantId: string,
  conversationId: string,
) {
  const conversation = document.conversations.find(
    (item) => item.tenantId === tenantId && item.id === conversationId,
  );

  if (!conversation) {
    throw new Error("Conversation record not found.");
  }

  return conversation;
}

export function appendDealHistoryRecord(
  deal: SalesDealRecord,
  input: Pick<SalesDealActionInput, "actorName" | "actorRole">,
  event: string,
  message: string,
  createdAt = new Date().toISOString(),
) {
  deal.history = [
    ...deal.history,
    {
      id: randomUUID(),
      actorName: input.actorName,
      actorRole: input.actorRole,
      event,
      message,
      createdAt,
    },
  ];
  deal.updatedAt = createdAt;
}

export function appendConversationMessageRecord(
  conversation: ConversationRecord,
  input: SalesFloorConversationMessageInput,
) {
  const sentAt = input.sentAt ?? new Date().toISOString();
  const nextMessage: ConversationMessageRecord = {
    id: randomUUID(),
    authorName: input.authorName,
    body: input.body.trim(),
    direction: input.direction,
    sentAt,
  };

  conversation.messages = [...conversation.messages, nextMessage];
  conversation.lastMessageAt = sentAt;
  conversation.lastPreview = nextMessage.body;

  if (input.direction === "INBOUND") {
    conversation.unreadCount += 1;
    conversation.status = conversation.escalated ? "ESCALATED" : "PENDING_EMPLOYEE";
  }

  if (input.direction === "OUTBOUND") {
    conversation.unreadCount = 0;
    conversation.status = "PENDING_CUSTOMER";
  }

  if (input.direction === "INTERNAL_NOTE") {
    conversation.notesCount += 1;
  }

  return nextMessage;
}

export function applySalesDealActionRecord(
  deal: SalesDealRecord,
  input: SalesDealActionInput,
) {
  const now = new Date().toISOString();
  const nextAction = trimOptional(input.nextAction);
  const appointmentWindow = trimOptional(input.appointmentWindow);
  const managerHandoffReason = trimOptional(input.managerHandoffReason);
  const paymentQuote = trimOptional(input.paymentQuote);
  const lenderSummary = trimOptional(input.lenderSummary);
  const lostReason = trimOptional(input.lostReason);

  switch (input.action) {
    case "BOOK_APPOINTMENT":
      deal.stage = "APPOINTMENT";
      deal.appointmentStatus = "BOOKED";
      deal.appointmentWindow = appointmentWindow || deal.appointmentWindow;
      deal.nextAction =
        nextAction || "Keep the appointment warm and confirm arrival before the visit.";
      appendDealHistoryRecord(
        deal,
        input,
        "APPOINTMENT_BOOKED",
        `Appointment locked${deal.appointmentWindow ? ` for ${deal.appointmentWindow}` : ""}.`,
        now,
      );
      break;
    case "COMPLETE_APPOINTMENT":
      deal.appointmentStatus = "COMPLETED";
      deal.stage =
        deal.managerPacketStatus === "APPROVED" ? "FINANCE_READY" : "MANAGER_REVIEW";
      deal.nextAction =
        nextAction || "Structure final numbers while the buyer is still in-store.";
      appendDealHistoryRecord(
        deal,
        input,
        "APPOINTMENT_COMPLETED",
        "Buyer visit completed and the deal moved toward desk review.",
        now,
      );
      break;
    case "SEND_TO_MANAGER":
      deal.stage = "MANAGER_REVIEW";
      deal.managerPacketStatus = "READY";
      deal.managerHandoffReason =
        managerHandoffReason || deal.managerHandoffReason || "Buyer is ready for manager review.";
      deal.nextAction =
        nextAction || "Manager to return numbers while the salesperson keeps the buyer warm.";
      if (paymentQuote) {
        deal.paymentQuote = paymentQuote;
      }
      if (lenderSummary) {
        deal.lenderSummary = lenderSummary;
      }
      appendDealHistoryRecord(
        deal,
        input,
        "MANAGER_REVIEW_STARTED",
        `Deal handed to the desk${deal.managerHandoffReason ? `: ${deal.managerHandoffReason}` : "."}`,
        now,
      );
      break;
    case "SEND_QUOTE":
      deal.stage = "MANAGER_REVIEW";
      deal.managerPacketStatus = "QUOTE_SENT";
      deal.paymentQuote = paymentQuote || deal.paymentQuote;
      deal.lenderSummary = lenderSummary || deal.lenderSummary;
      deal.nextAction =
        nextAction || "Follow up on quote fit, trade details, and the buyer's commitment level.";
      appendDealHistoryRecord(
        deal,
        input,
        "QUOTE_SENT",
        `Quote sent${deal.paymentQuote ? `: ${deal.paymentQuote}` : "."}`,
        now,
      );
      break;
    case "REQUEST_INFO":
      deal.stage = "QUALIFYING";
      deal.managerPacketStatus = "NEEDS_INFO";
      deal.nextAction =
        nextAction || "Collect missing budget, trade, and lender details for the desk packet.";
      appendDealHistoryRecord(
        deal,
        input,
        "INFO_REQUESTED",
        "Manager asked for more deal structure information before approving numbers.",
        now,
      );
      break;
    case "APPROVE_FINANCE":
      deal.stage = "FINANCE_READY";
      deal.managerPacketStatus = "APPROVED";
      deal.lenderSummary = lenderSummary || deal.lenderSummary;
      deal.paymentQuote = paymentQuote || deal.paymentQuote;
      deal.nextAction =
        nextAction || "Confirm arrival time, stips, and the final commitment path.";
      appendDealHistoryRecord(
        deal,
        input,
        "FINANCE_APPROVED",
        `Finance path approved${deal.lenderSummary ? `: ${deal.lenderSummary}` : "."}`,
        now,
      );
      break;
    case "MARK_SOLD":
      deal.stage = "SOLD";
      deal.managerPacketStatus = "APPROVED";
      deal.appointmentStatus =
        deal.appointmentStatus === "NONE" ? "COMPLETED" : deal.appointmentStatus;
      deal.nextAction = nextAction || "Deliver the vehicle and move the deal into funding.";
      deal.closedAt = now;
      appendDealHistoryRecord(
        deal,
        input,
        "DEAL_SOLD",
        "Deal marked sold and handed to delivery/funding.",
        now,
      );
      break;
    case "MARK_LOST":
      deal.stage = "LOST";
      deal.lostReason = lostReason || "Buyer chose not to move forward.";
      deal.nextAction =
        nextAction || "Archive this opportunity and revisit the buyer with a later follow-up.";
      deal.closedAt = now;
      appendDealHistoryRecord(
        deal,
        input,
        "DEAL_LOST",
        `Deal marked lost${deal.lostReason ? `: ${deal.lostReason}` : "."}`,
        now,
      );
      break;
  }
}

export function addSalesDealNoteRecord(
  deal: SalesDealRecord,
  input: SalesDealNoteInput,
) {
  const now = new Date().toISOString();
  const noteBody = input.body.trim();

  deal.notes = [
    ...deal.notes,
    {
      id: randomUUID(),
      actorName: input.actorName,
      actorRole: input.actorRole,
      body: noteBody,
      createdAt: now,
    },
  ];

  appendDealHistoryRecord(
    deal,
    input,
    "NOTE_ADDED",
    `Internal note added: ${noteBody}`,
    now,
  );
}

export async function updateSalesFloorTenant<T>(
  tenantId: string,
  callback: (context: {
    document: SalesFloorDocument;
    requireDeal: (dealId: string) => SalesDealRecord;
    requireConversation: (conversationId: string) => ConversationRecord;
  }) => Promise<T> | T,
): Promise<{ salesFloor: SalesFloorState; result: T }> {
  return withDocumentLock(async (document) => {
    ensureTenantSeeded(document, tenantId);

    const result = await callback({
      document,
      requireDeal: (dealId) => requireDeal(document, tenantId, dealId),
      requireConversation: (conversationId) =>
        requireConversation(document, tenantId, conversationId),
    });

    const savedDocument = await writeDocument(document);
    const tenantConversations = getTenantConversations(savedDocument, tenantId);

    return {
      result,
      salesFloor: buildSalesFloorState(
        savedDocument.deals,
        tenantId,
        tenantConversations,
      ),
    };
  });
}

async function persistIfSeeded(
  document: SalesFloorDocument,
  seeded: boolean,
) {
  if (seeded) {
    await writeDocument(document);
  }
}

export async function getSalesFloorState(tenantId: string): Promise<SalesFloorState> {
  return withDocumentLock(async (document) => {
    const seeded = ensureTenantSeeded(document, tenantId);
    await persistIfSeeded(document, seeded);
    return buildSalesFloorState(
      document.deals,
      tenantId,
      getTenantConversations(document, tenantId),
    );
  });
}

export async function applySalesDealActionForTenant(
  tenantId: string,
  dealId: string,
  input: SalesDealActionInput,
): Promise<SalesFloorState> {
  const result = await updateSalesFloorTenant(tenantId, ({ requireDeal }) => {
    const deal = requireDeal(dealId);
    applySalesDealActionRecord(deal, input);
  });

  return result.salesFloor;
}

export async function addSalesDealNoteForTenant(
  tenantId: string,
  dealId: string,
  input: SalesDealNoteInput,
): Promise<SalesFloorState> {
  const result = await updateSalesFloorTenant(tenantId, ({ requireDeal }) => {
    const deal = requireDeal(dealId);
    addSalesDealNoteRecord(deal, input);
  });

  return result.salesFloor;
}

export async function simulateCustomerMessageForTenant(
  tenantId: string,
  conversationId: string,
  body: string,
): Promise<SalesFloorState> {
  const result = await updateSalesFloorTenant(
    tenantId,
    ({ document, requireConversation }) => {
      const conversation = requireConversation(conversationId);
      appendConversationMessageRecord(conversation, {
        direction: "INBOUND",
        authorName: conversation.customerName,
        body,
      });

      const deal = document.deals.find(
        (item) =>
          item.tenantId === tenantId && item.conversationId === conversation.id,
      );

      if (deal) {
        appendDealHistoryRecord(
          deal,
          {
            actorName: conversation.customerName,
            actorRole: "SYSTEM",
          },
          "CUSTOMER_MESSAGE",
          `Customer replied: ${body.trim()}`,
        );
      }
    },
  );

  return result.salesFloor;
}

export async function resetSalesFloorTenant(tenantId: string) {
  return withDocumentLock(async (document) => {
    document.deals = document.deals.filter((deal) => deal.tenantId !== tenantId);
    document.conversations = document.conversations.filter(
      (conversation) => conversation.tenantId !== tenantId,
    );

    await writeDocument(document);
  });
}
