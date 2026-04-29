import "server-only";

import {
  getActiveAppointmentForDeal,
  getAppointmentSnapshot,
  markAppointmentCompleted,
  markAppointmentConfirmationSent,
  markAppointmentNoShow,
  upsertAppointmentForDeal,
} from "@/lib/appointment-persistence";
import {
  cancelPendingAgentTasksForDeal,
  claimDueAgentTasks,
  finalizeAgentTask,
  getAgentTaskSnapshot,
  queueAgentTasks,
  recordAgentWorkerSummary,
  type AgentTaskDraft,
} from "@/lib/agent-task-persistence";
import { evaluateManagerAutoApproval } from "@/lib/manager-approval-rules";
import { recordOutboundPolicyMessage } from "@/lib/outbound-message-service";
import { renderReplyPolicy } from "@/lib/reply-policies";
import {
  appendConversationMessageRecord,
  appendDealHistoryRecord,
  applySalesDealActionRecord,
  getSalesFloorState,
  updateSalesFloorTenant,
} from "@/lib/sales-floor-persistence";
import type {
  AgentTaskRecord,
  AgentWorkerSummary,
  ConversationMessageRecord,
  ConversationRecord,
  OutboundMessagePolicyId,
  SalesAppointmentRecord,
  SalesDealRecord,
} from "@/lib/types";

const AUTOMATION_ACTOR = {
  actorName: "Autonomous Sales Agent",
  actorRole: "SYSTEM" as const,
};

function getLatestMessage(
  conversation: ConversationRecord,
  direction?: ConversationMessageRecord["direction"],
) {
  const filteredMessages = direction
    ? conversation.messages.filter((message) => message.direction === direction)
    : conversation.messages;

  return [...filteredMessages].sort(
    (left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt),
  )[0];
}

function getLatestInboundBody(conversation: ConversationRecord) {
  return getLatestMessage(conversation, "INBOUND")?.body.toLowerCase() || "";
}

function isWaitingOnSalesperson(conversation: ConversationRecord) {
  const latestInbound = getLatestMessage(conversation, "INBOUND");
  const latestOutbound = getLatestMessage(conversation, "OUTBOUND");

  if (!latestInbound) {
    return false;
  }

  if (!latestOutbound) {
    return true;
  }

  return Date.parse(latestInbound.sentAt) > Date.parse(latestOutbound.sentAt);
}

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function compactTaskDrafts(
  drafts: Array<AgentTaskDraft | null | undefined>,
): AgentTaskDraft[] {
  return drafts.filter((draft): draft is AgentTaskDraft => Boolean(draft));
}

function getFollowUpDelayHours(deal: SalesDealRecord, step = 1) {
  if (step >= 3) {
    return 72;
  }

  switch (deal.stage) {
    case "MANAGER_REVIEW":
    case "FINANCE_READY":
      return step === 1 ? 2 : 18;
    case "APPOINTMENT":
      return step === 1 ? 4 : 24;
    case "VEHICLE_MATCH":
      return step === 1 ? 6 : 24;
    case "QUALIFYING":
    default:
      return step === 1 ? 12 : 36;
  }
}

function countCompletedFollowUps(tasks: AgentTaskRecord[], dealId: string) {
  return tasks.filter(
    (task) =>
      task.dealId === dealId &&
      task.kind === "FOLLOW_UP" &&
      task.status === "SUCCEEDED",
  ).length;
}

function extractAppointmentWindow(
  deal: SalesDealRecord,
  conversation: ConversationRecord,
) {
  const messageBody = getLatestInboundBody(conversation);
  const rawWindow = deal.appointmentWindow || "Tomorrow at 10:00 AM";
  const options = rawWindow.split(" or ").map((value) => value.trim());

  if (messageBody.includes("10")) {
    return options.find((value) => value.includes("10")) || options[0];
  }

  if (messageBody.includes("1") || messageBody.includes("afternoon")) {
    return options.find((value) => value.includes("1")) || options[0];
  }

  return options[0];
}

function isAppointmentConfirmed(
  deal: SalesDealRecord,
  conversation: ConversationRecord,
) {
  if (deal.appointmentStatus === "BOOKED" || deal.stage === "SOLD" || deal.stage === "LOST") {
    return false;
  }

  const body = getLatestInboundBody(conversation);

  if (!body) {
    return false;
  }

  return [
    "works for me",
    "lock it in",
    "book it",
    "see you then",
    "i can do",
    "that works",
  ].some((phrase) => body.includes(phrase));
}

function hasClearFinanceIntent(
  deal: SalesDealRecord,
  conversation: ConversationRecord,
) {
  if (deal.stage === "SOLD" || deal.stage === "LOST") {
    return false;
  }

  if (deal.managerPacketStatus !== "NOT_READY") {
    return false;
  }

  const body = getLatestInboundBody(conversation);

  return (
    deal.buyerIntent === "finance" ||
    ["payment", "finance", "financing", "monthly", "down payment", "apr"].some(
      (keyword) => body.includes(keyword),
    )
  );
}

function buildSafeReplyMessage(
  deal: SalesDealRecord,
  conversation: ConversationRecord,
) {
  const body = getLatestInboundBody(conversation);

  if (body.includes("available")) {
    return deal.suggestedReply;
  }

  if (body.includes("sunroof") || body.includes("feature")) {
    return deal.suggestedReply;
  }

  if (body.includes("test drive") || body.includes("schedule")) {
    return `Absolutely. I can help with that. ${deal.suggestedReply}`;
  }

  return deal.suggestedReply;
}

function buildFollowUpMessage(deal: SalesDealRecord, step: number) {
  if (deal.stage === "APPOINTMENT") {
    return `Checking back on the ${deal.vehicleLabel}. I can still hold ${deal.appointmentWindow || "your visit slot"} if you want me to keep it reserved.`;
  }

  if (deal.stage === "MANAGER_REVIEW" || deal.stage === "FINANCE_READY") {
    return `I still have the numbers working on the ${deal.vehicleLabel}. If you want the clean structure before you come in, I can send it over.`;
  }

  if (step >= 2 && deal.backupVehicleId) {
    return `Still with you on the ${deal.vehicleLabel}. If you want a second option, I can also line up the backup unit attached to your deal so you are not driving over blind.`;
  }

  return `Just checking back on the ${deal.vehicleLabel}. If you want, I can answer anything on availability, payment, or the next visit window and keep this easy.`;
}

function shouldAutoSendSafeReply(
  deal: SalesDealRecord,
  conversation: ConversationRecord,
) {
  if (!isWaitingOnSalesperson(conversation)) {
    return false;
  }

  const body = getLatestInboundBody(conversation);

  if (!body) {
    return false;
  }

  if (isAppointmentConfirmed(deal, conversation) || hasClearFinanceIntent(deal, conversation)) {
    return false;
  }

  return [
    "available",
    "sunroof",
    "tow",
    "test drive",
    "schedule",
    "still there",
  ].some((keyword) => body.includes(keyword));
}

function buildFollowUpTaskDraft(
  deal: SalesDealRecord,
  step = 1,
): AgentTaskDraft | null {
  if (deal.stage === "SOLD" || deal.stage === "LOST" || step > 3) {
    return null;
  }

  return {
    tenantId: deal.tenantId,
    dealId: deal.id,
    conversationId: deal.conversationId,
    kind: "FOLLOW_UP",
    title: step === 1 ? "First automated follow-up" : `Follow-up step ${step}`,
    reason: "Buyer has gone quiet and the next touch should happen automatically.",
    scheduledFor: hoursFromNow(getFollowUpDelayHours(deal, step)),
    followUpStep: step,
    messageDraft: buildFollowUpMessage(deal, step),
  };
}

function buildAppointmentLifecycleTaskDrafts(
  appointment: SalesAppointmentRecord,
): AgentTaskDraft[] {
  if (["COMPLETED", "NO_SHOW", "CANCELED"].includes(appointment.status)) {
    return [];
  }

  const now = Date.now();
  const confirmationDueAt = new Date(
    Math.max(now, Date.parse(appointment.scheduledAt) - 18 * 60 * 60 * 1000),
  ).toISOString();
  const noShowDueAt = new Date(
    Date.parse(appointment.endsAt) + 20 * 60 * 1000,
  ).toISOString();

  return compactTaskDrafts([
    !appointment.confirmationSentAt
      ? {
          tenantId: appointment.tenantId,
          dealId: appointment.dealId,
          conversationId: appointment.conversationId,
          kind: "APPOINTMENT_CONFIRMATION",
          title: "Appointment confirmation",
          reason: "Booked visits should get a confirmation reminder before showtime.",
          scheduledFor: confirmationDueAt,
        }
      : null,
    {
      tenantId: appointment.tenantId,
      dealId: appointment.dealId,
      conversationId: appointment.conversationId,
      kind: "APPOINTMENT_NO_SHOW_CHECK",
      title: "Appointment no-show check",
      reason: "Booked visits should automatically roll into a rescue motion if the buyer does not show.",
      scheduledFor: noShowDueAt,
    },
  ]);
}

async function sendPolicyMessageForTenant(input: {
  tenantId: string;
  dealId: string;
  conversationId: string;
  policyId: OutboundMessagePolicyId;
  historyEvent: string;
  historyMessage: string;
  customMessage?: string;
  paymentQuote?: string;
}) {
  const salesFloor = await getSalesFloorState(input.tenantId);
  const deal = salesFloor.deals.find((item) => item.id === input.dealId);
  const conversation = salesFloor.conversations.find(
    (item) => item.id === input.conversationId,
  );
  const appointment = await getActiveAppointmentForDeal(input.tenantId, input.dealId);

  if (!deal || !conversation) {
    throw new Error("Unable to send an autonomous message without the live deal context.");
  }

  const messageBody = renderReplyPolicy(input.policyId, {
    deal,
    appointment: appointment || undefined,
    customMessage: input.customMessage,
    paymentQuote: input.paymentQuote,
  });

  await updateSalesFloorTenant(input.tenantId, ({ requireDeal, requireConversation }) => {
    const liveDeal = requireDeal(input.dealId);
    const liveConversation = requireConversation(input.conversationId);

    appendConversationMessageRecord(liveConversation, {
      direction: "OUTBOUND",
      authorName: AUTOMATION_ACTOR.actorName,
      body: messageBody,
    });

    appendDealHistoryRecord(
      liveDeal,
      AUTOMATION_ACTOR,
      input.historyEvent,
      input.historyMessage || messageBody,
    );
  });

  await recordOutboundPolicyMessage({
    tenantId: input.tenantId,
    dealId: input.dealId,
    conversationId: input.conversationId,
    channel: conversation.channel,
    actorName: AUTOMATION_ACTOR.actorName,
    policyId: input.policyId,
    context: {
      deal,
      appointment: appointment || undefined,
      customMessage: input.customMessage,
      paymentQuote: input.paymentQuote,
    },
  });
}

async function planAgentTasksForTenant(tenantId: string) {
  const salesFloor = await getSalesFloorState(tenantId);
  const taskSnapshot = await getAgentTaskSnapshot(tenantId);
  const appointments = await getAppointmentSnapshot(tenantId);
  const draftTasks: AgentTaskDraft[] = [];

  for (const appointment of appointments) {
    draftTasks.push(...buildAppointmentLifecycleTaskDrafts(appointment));
  }

  for (const deal of salesFloor.deals.filter(
    (item) => item.stage !== "SOLD" && item.stage !== "LOST",
  )) {
    const conversation = salesFloor.conversations.find(
      (item) => item.id === deal.conversationId,
    );
    const vehicle = salesFloor.vehicles.find((item) => item.id === deal.vehicleId);
    const appointment = appointments.find((item) => item.dealId === deal.id);

    if (!conversation) {
      continue;
    }

    const latestCustomerFacing = [...conversation.messages]
      .filter((message) => message.direction !== "INTERNAL_NOTE")
      .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))[0];
    const completedFollowUps = countCompletedFollowUps(taskSnapshot.tasks, deal.id);

    if (isAppointmentConfirmed(deal, conversation)) {
      draftTasks.push({
        tenantId,
        dealId: deal.id,
        conversationId: conversation.id,
        kind: "BOOK_APPOINTMENT",
        title: "Book confirmed appointment",
        reason: "Buyer confirmed a visit slot in the conversation.",
        scheduledFor: new Date().toISOString(),
        appointmentWindow: extractAppointmentWindow(deal, conversation),
      });
      continue;
    }

    if (hasClearFinanceIntent(deal, conversation)) {
      draftTasks.push({
        tenantId,
        dealId: deal.id,
        conversationId: conversation.id,
        kind: "CREATE_MANAGER_PACKET",
        title: "Open manager packet",
        reason: "Buyer is clearly talking in payment and finance terms.",
        scheduledFor: new Date().toISOString(),
        managerReason:
          "Buyer is asking for finance structure and should be moved to a desk packet.",
      });
      continue;
    }

    const autoApproval = evaluateManagerAutoApproval({
      deal,
      conversation,
      vehicle,
      appointment,
    });

    if (autoApproval.approved) {
      draftTasks.push({
        tenantId,
        dealId: deal.id,
        conversationId: conversation.id,
        kind: "MANAGER_AUTO_APPROVAL",
        title: "Manager auto-approval",
        reason:
          autoApproval.reason ||
          "This packet qualifies for the auto-approved desk lane.",
        scheduledFor: new Date().toISOString(),
      });
      continue;
    }

    if (shouldAutoSendSafeReply(deal, conversation)) {
      draftTasks.push({
        tenantId,
        dealId: deal.id,
        conversationId: conversation.id,
        kind: "SAFE_REPLY",
        title: "Send safe buyer reply",
        reason: "Latest buyer message can be handled safely by policy.",
        scheduledFor: new Date().toISOString(),
        messageDraft: buildSafeReplyMessage(deal, conversation),
      });
      continue;
    }

    if (
      latestCustomerFacing?.direction === "OUTBOUND" &&
      completedFollowUps < 3
    ) {
      const followUpDelayHours = getFollowUpDelayHours(deal, completedFollowUps + 1);
      const dueAt = new Date(
        Date.parse(latestCustomerFacing.sentAt) + followUpDelayHours * 60 * 60 * 1000,
      ).toISOString();

      if (Date.parse(dueAt) <= Date.now()) {
        draftTasks.push({
          tenantId,
          dealId: deal.id,
          conversationId: conversation.id,
          kind: "FOLLOW_UP",
          title:
            completedFollowUps === 0
              ? "First automated follow-up"
              : `Follow-up step ${completedFollowUps + 1}`,
          reason: "Buyer has not replied and the next follow-up is now due.",
          scheduledFor: new Date().toISOString(),
          followUpStep: completedFollowUps + 1,
          messageDraft: buildFollowUpMessage(deal, completedFollowUps + 1),
        });
      }
    }
  }

  const scheduledCount = await queueAgentTasks(draftTasks);

  return {
    scannedDeals: salesFloor.deals.filter(
      (deal) => deal.stage !== "SOLD" && deal.stage !== "LOST",
    ).length,
    scheduledCount,
  };
}

async function executeAgentTask(tenantId: string, task: AgentTaskRecord) {
  switch (task.kind) {
    case "SAFE_REPLY": {
      await sendPolicyMessageForTenant({
        tenantId,
        dealId: task.dealId,
        conversationId: task.conversationId,
        policyId: "SAFE_REPLY",
        customMessage: task.messageDraft,
        historyEvent: "AUTO_REPLY_SENT",
        historyMessage: `Autonomous agent sent a safe reply: ${task.messageDraft || "Policy reply sent."}`,
      });

      const salesFloor = await getSalesFloorState(tenantId);
      const deal = salesFloor.deals.find((item) => item.id === task.dealId);

      return {
        sentMessages: 1,
        bookedAppointments: 0,
        appointmentRemindersSent: 0,
        noShowsMarked: 0,
        managerPacketsCreated: 0,
        autoApprovedPackets: 0,
        nextTasks: compactTaskDrafts(
          deal ? [buildFollowUpTaskDraft(deal, 1)] : [],
        ),
      };
    }
    case "FOLLOW_UP": {
      await sendPolicyMessageForTenant({
        tenantId,
        dealId: task.dealId,
        conversationId: task.conversationId,
        policyId: "FOLLOW_UP",
        customMessage: task.messageDraft,
        historyEvent: "AUTO_FOLLOW_UP_SENT",
        historyMessage: `Autonomous follow-up sent: ${task.messageDraft || "Follow-up policy fired."}`,
      });

      const salesFloor = await getSalesFloorState(tenantId);
      const deal = salesFloor.deals.find((item) => item.id === task.dealId);
      const nextStep = (task.followUpStep || 1) + 1;

      return {
        sentMessages: 1,
        bookedAppointments: 0,
        appointmentRemindersSent: 0,
        noShowsMarked: 0,
        managerPacketsCreated: 0,
        autoApprovedPackets: 0,
        nextTasks: compactTaskDrafts(
          deal && nextStep <= 3 ? [buildFollowUpTaskDraft(deal, nextStep)] : [],
        ),
      };
    }
    case "BOOK_APPOINTMENT": {
      const updatedSalesFloor = await updateSalesFloorTenant(
        tenantId,
        ({ requireDeal, requireConversation }) => {
          const deal = requireDeal(task.dealId);
          const conversation = requireConversation(task.conversationId);
          const appointmentWindow =
            task.appointmentWindow || extractAppointmentWindow(deal, conversation);

          applySalesDealActionRecord(deal, {
            ...AUTOMATION_ACTOR,
            action: "BOOK_APPOINTMENT",
            appointmentWindow,
            nextAction:
              "Keep the appointment warm, confirm arrival, and prep the desk if payments come up.",
          });
        },
      );

      const bookedDeal = updatedSalesFloor.salesFloor.deals.find(
        (item) => item.id === task.dealId,
      );

      if (!bookedDeal) {
        throw new Error("Booked deal not found after autonomous appointment update.");
      }

      const appointment = await upsertAppointmentForDeal({
        tenantId,
        deal: bookedDeal,
        customerName: bookedDeal.customerName,
        vehicleLabel: bookedDeal.vehicleLabel,
        windowLabel: bookedDeal.appointmentWindow,
        confirmed: true,
      });

      await sendPolicyMessageForTenant({
        tenantId,
        dealId: task.dealId,
        conversationId: task.conversationId,
        policyId: "APPOINTMENT_BOOKED",
        historyEvent: "AUTO_APPOINTMENT_BOOKED",
        historyMessage: `Autonomous agent booked the appointment for ${appointment.windowLabel}.`,
      });

      return {
        sentMessages: 1,
        bookedAppointments: 1,
        appointmentRemindersSent: 0,
        noShowsMarked: 0,
        managerPacketsCreated: 0,
        autoApprovedPackets: 0,
        nextTasks: buildAppointmentLifecycleTaskDrafts(appointment),
      };
    }
    case "APPOINTMENT_CONFIRMATION": {
      const appointment = await getActiveAppointmentForDeal(tenantId, task.dealId);

      if (!appointment) {
        return {
          sentMessages: 0,
          bookedAppointments: 0,
          appointmentRemindersSent: 0,
          noShowsMarked: 0,
          managerPacketsCreated: 0,
          autoApprovedPackets: 0,
          nextTasks: [],
        };
      }

      await sendPolicyMessageForTenant({
        tenantId,
        dealId: task.dealId,
        conversationId: task.conversationId,
        policyId: "APPOINTMENT_CONFIRMATION",
        historyEvent: "APPOINTMENT_CONFIRMATION_SENT",
        historyMessage: `Autonomous reminder sent for the ${appointment.windowLabel} appointment.`,
      });

      await markAppointmentConfirmationSent(tenantId, task.dealId);

      return {
        sentMessages: 1,
        bookedAppointments: 0,
        appointmentRemindersSent: 1,
        noShowsMarked: 0,
        managerPacketsCreated: 0,
        autoApprovedPackets: 0,
        nextTasks: [],
      };
    }
    case "APPOINTMENT_NO_SHOW_CHECK": {
      const salesFloor = await getSalesFloorState(tenantId);
      const deal = salesFloor.deals.find((item) => item.id === task.dealId);
      const appointment = await getActiveAppointmentForDeal(tenantId, task.dealId);

      if (!deal || !appointment) {
        return {
          sentMessages: 0,
          bookedAppointments: 0,
          appointmentRemindersSent: 0,
          noShowsMarked: 0,
          managerPacketsCreated: 0,
          autoApprovedPackets: 0,
          nextTasks: [],
        };
      }

      if (deal.stage === "SOLD" || deal.stage === "FINANCE_READY") {
        await markAppointmentCompleted(tenantId, task.dealId);
        return {
          sentMessages: 0,
          bookedAppointments: 0,
          appointmentRemindersSent: 0,
          noShowsMarked: 0,
          managerPacketsCreated: 0,
          autoApprovedPackets: 0,
          nextTasks: [],
        };
      }

      await markAppointmentNoShow(tenantId, task.dealId);

      await updateSalesFloorTenant(tenantId, ({ requireDeal }) => {
        const liveDeal = requireDeal(task.dealId);
        liveDeal.appointmentStatus = "PROPOSED";
        liveDeal.nextAction =
          "Rescue the missed appointment and offer a fresh visit window today.";
        appendDealHistoryRecord(
          liveDeal,
          AUTOMATION_ACTOR,
          "APPOINTMENT_NO_SHOW",
          "Appointment was marked as a no-show and the rescue sequence started.",
        );
      });

      await sendPolicyMessageForTenant({
        tenantId,
        dealId: task.dealId,
        conversationId: task.conversationId,
        policyId: "APPOINTMENT_NO_SHOW",
        historyEvent: "NO_SHOW_RESCUE_SENT",
        historyMessage: "Autonomous no-show rescue message sent to the buyer.",
      });

      return {
        sentMessages: 1,
        bookedAppointments: 0,
        appointmentRemindersSent: 0,
        noShowsMarked: 1,
        managerPacketsCreated: 0,
        autoApprovedPackets: 0,
        nextTasks: compactTaskDrafts(
          deal ? [buildFollowUpTaskDraft(deal, 1)] : [],
        ),
      };
    }
    case "CREATE_MANAGER_PACKET": {
      await updateSalesFloorTenant(tenantId, ({ requireDeal, requireConversation }) => {
        const deal = requireDeal(task.dealId);
        const conversation = requireConversation(task.conversationId);
        const managerReason =
          task.managerReason ||
          "Buyer is now focused on finance structure and needs the desk involved.";

        applySalesDealActionRecord(deal, {
          ...AUTOMATION_ACTOR,
          action: "SEND_TO_MANAGER",
          managerHandoffReason: managerReason,
          nextAction:
            "Desk to return a clean structure while the agent keeps the buyer engaged.",
        });

        conversation.escalated = true;
        conversation.status = "ESCALATED";
      });

      await sendPolicyMessageForTenant({
        tenantId,
        dealId: task.dealId,
        conversationId: task.conversationId,
        policyId: "MANAGER_PACKET_STARTED",
        historyEvent: "MANAGER_PACKET_STARTED",
        historyMessage: "Autonomous manager packet was created and surfaced to the buyer.",
      });

      const salesFloor = await getSalesFloorState(tenantId);
      const deal = salesFloor.deals.find((item) => item.id === task.dealId);

      return {
        sentMessages: 1,
        bookedAppointments: 0,
        appointmentRemindersSent: 0,
        noShowsMarked: 0,
        managerPacketsCreated: 1,
        autoApprovedPackets: 0,
        nextTasks: compactTaskDrafts(
          deal ? [buildFollowUpTaskDraft(deal, 1)] : [],
        ),
      };
    }
    case "MANAGER_AUTO_APPROVAL": {
      const salesFloor = await getSalesFloorState(tenantId);
      const deal = salesFloor.deals.find((item) => item.id === task.dealId);
      const conversation = salesFloor.conversations.find(
        (item) => item.id === task.conversationId,
      );
      const vehicle = salesFloor.vehicles.find((item) => item.id === deal?.vehicleId);
      const appointment = await getActiveAppointmentForDeal(tenantId, task.dealId);

      if (!deal || !conversation) {
        throw new Error("Deal context disappeared before manager auto-approval could run.");
      }

      const approval = evaluateManagerAutoApproval({
        deal,
        conversation,
        vehicle,
        appointment: appointment || undefined,
      });

      if (!approval.approved) {
        return {
          sentMessages: 0,
          bookedAppointments: 0,
          appointmentRemindersSent: 0,
          noShowsMarked: 0,
          managerPacketsCreated: 0,
          autoApprovedPackets: 0,
          nextTasks: [],
        };
      }

      await updateSalesFloorTenant(tenantId, ({ requireDeal }) => {
        const liveDeal = requireDeal(task.dealId);

        applySalesDealActionRecord(liveDeal, {
          ...AUTOMATION_ACTOR,
          action: "APPROVE_FINANCE",
          paymentQuote: approval.paymentQuote,
          lenderSummary: approval.lenderSummary,
          nextAction:
            "Confirm the visit or final commitment while the auto-approved packet stays active.",
        });

        appendDealHistoryRecord(
          liveDeal,
          AUTOMATION_ACTOR,
          "MANAGER_AUTO_APPROVED",
          approval.reason || "Manager rules engine auto-approved this packet.",
        );
      });

      await sendPolicyMessageForTenant({
        tenantId,
        dealId: task.dealId,
        conversationId: task.conversationId,
        policyId: "MANAGER_AUTO_APPROVED",
        paymentQuote: approval.paymentQuote,
        historyEvent: "AUTO_APPROVAL_QUOTE_SENT",
        historyMessage:
          approval.reason || "Auto-approved desk packet sent to the buyer.",
      });

      const refreshedSalesFloor = await getSalesFloorState(tenantId);
      const refreshedDeal = refreshedSalesFloor.deals.find(
        (item) => item.id === task.dealId,
      );

      return {
        sentMessages: 1,
        bookedAppointments: 0,
        appointmentRemindersSent: 0,
        noShowsMarked: 0,
        managerPacketsCreated: 0,
        autoApprovedPackets: 1,
        nextTasks: compactTaskDrafts(
          refreshedDeal ? [buildFollowUpTaskDraft(refreshedDeal, 1)] : [],
        ),
      };
    }
  }
}

export async function runAutonomousAgentWorker(tenantId: string) {
  const startedAt = new Date().toISOString();
  const planning = await planAgentTasksForTenant(tenantId);
  const claimedTasks = await claimDueAgentTasks(tenantId, new Date().toISOString());

  let sentMessages = 0;
  let bookedAppointments = 0;
  let appointmentRemindersSent = 0;
  let noShowsMarked = 0;
  let managerPacketsCreated = 0;
  let autoApprovedPackets = 0;
  let executedTasks = 0;
  let followUpsScheduled = 0;
  const notes: string[] = [];

  for (const task of claimedTasks) {
    try {
      const execution = await executeAgentTask(tenantId, task);
      executedTasks += 1;
      sentMessages += execution.sentMessages;
      bookedAppointments += execution.bookedAppointments;
      appointmentRemindersSent += execution.appointmentRemindersSent;
      noShowsMarked += execution.noShowsMarked;
      managerPacketsCreated += execution.managerPacketsCreated;
      autoApprovedPackets += execution.autoApprovedPackets;
      followUpsScheduled += execution.nextTasks.filter(
        (draft) => draft.kind === "FOLLOW_UP",
      ).length;
      notes.push(`${task.kind.replaceAll("_", " ")} completed for ${task.dealId}.`);

      await finalizeAgentTask(task.id, {
        status: "SUCCEEDED",
        nextTasks: execution.nextTasks,
      });
    } catch (error) {
      await finalizeAgentTask(task.id, {
        status: "FAILED",
        lastError:
          error instanceof Error
            ? error.message
            : "Autonomous worker failed while executing the task.",
      });

      notes.push(
        error instanceof Error
          ? error.message
          : `Task ${task.id} failed during autonomous execution.`,
      );
    }
  }

  for (const deal of (await getSalesFloorState(tenantId)).deals.filter(
    (item) => item.stage === "SOLD" || item.stage === "LOST",
  )) {
    await cancelPendingAgentTasksForDeal(tenantId, deal.id);
  }

  const summary: AgentWorkerSummary = {
    tenantId,
    startedAt,
    completedAt: new Date().toISOString(),
    scannedDeals: planning.scannedDeals,
    scheduledTasks: planning.scheduledCount + followUpsScheduled,
    executedTasks,
    sentMessages,
    bookedAppointments,
    appointmentRemindersSent,
    noShowsMarked,
    managerPacketsCreated,
    autoApprovedPackets,
    followUpsScheduled,
    notes,
  };

  await recordAgentWorkerSummary(summary);

  const snapshot = await getAgentTaskSnapshot(tenantId);

  return {
    tasks: snapshot.tasks,
    lastRunSummary: summary,
  };
}
