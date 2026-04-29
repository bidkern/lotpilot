import type {
  ConversationRecord,
  SalesAppointmentRecord,
  SalesDealRecord,
  VehicleRecord,
} from "@/lib/types";

interface ManagerApprovalDecision {
  approved: boolean;
  ruleId?: string;
  reason?: string;
  paymentQuote?: string;
  lenderSummary?: string;
}

function estimateMonthlyPayment(priceCents: number, downPaymentRate = 0.1) {
  const principal = priceCents / 100;
  const financedAmount = principal * (1 - downPaymentRate);
  const monthlyRate = 0.069 / 12;
  const months = 72;
  const payment =
    (financedAmount * monthlyRate) /
    (1 - Math.pow(1 + monthlyRate, -months));

  return Math.round(payment);
}

function hasRedFlagFinanceTerms(conversation: ConversationRecord) {
  const haystack = conversation.messages
    .map((message) => message.body.toLowerCase())
    .join(" ");

  return [
    "negative equity",
    "upside down",
    "repo",
    "bankruptcy",
    "charge off",
    "owe too much",
    "bad credit",
  ].some((term) => haystack.includes(term));
}

function hasPaymentIntent(deal: SalesDealRecord, conversation: ConversationRecord) {
  if (deal.buyerIntent === "finance") {
    return true;
  }

  const latestInbound = [...conversation.messages]
    .filter((message) => message.direction === "INBOUND")
    .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))[0];
  const haystack = latestInbound?.body.toLowerCase() || "";

  return ["payment", "finance", "monthly", "down payment", "apr"].some((term) =>
    haystack.includes(term),
  );
}

export function evaluateManagerAutoApproval(input: {
  deal: SalesDealRecord;
  conversation: ConversationRecord;
  vehicle: VehicleRecord | undefined;
  appointment?: SalesAppointmentRecord;
}): ManagerApprovalDecision {
  const { deal, conversation, vehicle, appointment } = input;

  if (
    deal.managerPacketStatus === "APPROVED" ||
    deal.stage === "SOLD" ||
    deal.stage === "LOST" ||
    !vehicle
  ) {
    return { approved: false };
  }

  if (hasRedFlagFinanceTerms(conversation)) {
    return {
      approved: false,
      reason: "Credit or payoff language suggests a human finance manager should review this packet.",
    };
  }

  if (!hasPaymentIntent(deal, conversation)) {
    return { approved: false };
  }

  const paymentQuote = `$${estimateMonthlyPayment(vehicle.priceCents)}/mo with about 10% down`;

  if (
    vehicle.priceCents <= 3_600_000 &&
    (appointment?.status === "BOOKED" || appointment?.status === "CONFIRMED")
  ) {
    return {
      approved: true,
      ruleId: "BOOKED_VISIT_STANDARD_UNIT",
      reason:
        "Booked visit plus payment intent on a standard used unit fits the auto-approved desk packet lane.",
      paymentQuote,
      lenderSummary:
        "Standard auto-approved lane with a 72-month structure assumption and no finance red flags detected.",
    };
  }

  if (vehicle.priceCents <= 3_200_000 && deal.priority !== "HOT") {
    return {
      approved: true,
      ruleId: "STANDARD_PAYMENT_FIRST_LANE",
      reason:
        "Payment-first shopper on a lower-risk unit fits the auto-approved desk packet lane.",
      paymentQuote,
      lenderSummary:
        "Auto-approved starter structure with conservative down payment and standard term assumptions.",
    };
  }

  return {
    approved: false,
    reason: "Packet still needs a human desk review before approval.",
  };
}
