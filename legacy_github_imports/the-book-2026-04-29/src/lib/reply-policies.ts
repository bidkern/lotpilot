import type {
  OutboundMessagePolicyId,
  SalesAppointmentRecord,
  SalesDealRecord,
} from "@/lib/types";

export interface ReplyPolicyContext {
  deal: SalesDealRecord;
  appointment?: SalesAppointmentRecord;
  customMessage?: string;
  paymentQuote?: string;
}

export function renderReplyPolicy(
  policyId: OutboundMessagePolicyId,
  context: ReplyPolicyContext,
) {
  const { deal, appointment } = context;

  switch (policyId) {
    case "SAFE_REPLY":
      return context.customMessage || deal.suggestedReply;
    case "FOLLOW_UP":
      return (
        context.customMessage ||
        `Just checking back on the ${deal.vehicleLabel}. If you want, I can help with availability, payment direction, or the next visit window and keep this easy.`
      );
    case "APPOINTMENT_BOOKED":
      return (
        context.customMessage ||
        `Perfect. You are locked in for ${appointment?.windowLabel || deal.appointmentWindow || "your visit window"} on the ${deal.vehicleLabel}. I will have it ready when you get here.`
      );
    case "APPOINTMENT_CONFIRMATION":
      return (
        context.customMessage ||
        `Quick confirmation on your ${deal.vehicleLabel} visit for ${appointment?.windowLabel || deal.appointmentWindow || "your scheduled slot"}. If that still works, I will keep everything set and ready for you.`
      );
    case "APPOINTMENT_NO_SHOW":
      return (
        context.customMessage ||
        `I missed you for the ${deal.vehicleLabel} appointment, so I am checking back before we lose the slot. If you still want it, I can reopen a fresh time for you today.`
      );
    case "MANAGER_PACKET_STARTED":
      return (
        context.customMessage ||
        `I am pulling the exact numbers with my manager now so I can keep this clean for you.${deal.appointmentWindow ? ` I can still hold ${deal.appointmentWindow} while we tighten it up.` : ""}`
      );
    case "MANAGER_AUTO_APPROVED":
      return (
        context.customMessage ||
        `Good news. I already have a clean desk path on the ${deal.vehicleLabel}${context.paymentQuote ? ` at about ${context.paymentQuote}` : ""}. If you want, I can keep your next step simple and line up the visit or final details from here.`
      );
  }
}
