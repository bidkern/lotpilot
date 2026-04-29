"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import {
  ArrowUpRight,
  CalendarCheck2,
  CheckCheck,
  CircleDollarSign,
  CreditCard,
  Radar,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { AutonomousAgentPanel } from "@/components/autopilot/autonomous-agent-panel";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatCard } from "@/components/ui/stat-card";
import { formatDateTime } from "@/lib/format";
import {
  addSalesDealNote,
  runSalesDealAction,
  useSalesFloor,
} from "@/lib/sales-floor-store";

const fieldClassName =
  "w-full rounded-[18px] border border-[var(--border)] bg-[var(--card-soft)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]";

const salesActionButtons = [
  {
    action: "BOOK_APPOINTMENT" as const,
    label: "Book visit",
    description: "Lock a time when the buyer agrees to come in.",
    tone: "forest" as const,
  },
  {
    action: "COMPLETE_APPOINTMENT" as const,
    label: "Mark visit complete",
    description: "Move the deal forward after the buyer shows up.",
    tone: "navy" as const,
  },
  {
    action: "SEND_TO_MANAGER" as const,
    label: "Send to desk",
    description: "Escalate when the buyer is ready for numbers or structure.",
    tone: "danger" as const,
  },
] as const;

const managerActionButtons = [
  {
    action: "SEND_QUOTE" as const,
    label: "Send quote",
    description: "Log a payment path and keep momentum alive.",
    tone: "navy" as const,
  },
  {
    action: "REQUEST_INFO" as const,
    label: "Request info",
    description: "Use when the packet is missing lender, trade, or budget detail.",
    tone: "tan" as const,
  },
  {
    action: "APPROVE_FINANCE" as const,
    label: "Approve finance",
    description: "Mark the desk path as ready to close.",
    tone: "forest" as const,
  },
  {
    action: "MARK_SOLD" as const,
    label: "Mark sold",
    description: "Close the deal and keep the audit trail intact.",
    tone: "forest" as const,
  },
  {
    action: "MARK_LOST" as const,
    label: "Mark lost",
    description: "Archive the opportunity with the reason attached.",
    tone: "slate" as const,
  },
] as const;

const stageSequence = [
  { key: "QUALIFYING", label: "Qualify" },
  { key: "VEHICLE_MATCH", label: "Match" },
  { key: "APPOINTMENT", label: "Visit" },
  { key: "MANAGER_REVIEW", label: "Desk" },
  { key: "FINANCE_READY", label: "Finance" },
] as const;

function getStageIndex(stage: string) {
  return stageSequence.findIndex((item) => item.key === stage);
}

export function AutonomousSalesmanDashboard() {
  const salesFloor = useSalesFloor();
  const snapshot = salesFloor.snapshot;
  const activeDeals = snapshot.dealBriefs.filter((deal) => !deal.isClosed);
  const closedDeals = snapshot.dealBriefs.filter((deal) => deal.isClosed);
  const [selectedDealId, setSelectedDealId] = useState(activeDeals[0]?.id);
  const [appointmentWindow, setAppointmentWindow] = useState("");
  const [managerReason, setManagerReason] = useState("");
  const [paymentQuote, setPaymentQuote] = useState("");
  const [lenderSummary, setLenderSummary] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!snapshot.dealBriefs.length) {
      return;
    }

    if (!selectedDealId || !snapshot.dealBriefs.some((deal) => deal.id === selectedDealId)) {
      startTransition(() => {
        setSelectedDealId(snapshot.dealBriefs[0]?.id);
      });
    }
  }, [selectedDealId, snapshot.dealBriefs]);

  const selectedBrief =
    snapshot.dealBriefs.find((deal) => deal.id === selectedDealId) ||
    snapshot.dealBriefs[0];
  const selectedDeal =
    salesFloor.deals.find((deal) => deal.id === selectedBrief?.id) ||
    salesFloor.deals[0];
  const selectedConversation = salesFloor.conversations.find(
    (conversation) => conversation.id === selectedDeal?.conversationId,
  );
  const selectedBriefId = selectedBrief?.id;
  const selectedBriefUpdatedAt = selectedBrief?.lastUpdatedAt;
  const selectedAppointmentWindow = selectedBrief?.appointmentWindow || "";
  const selectedManagerReason = selectedBrief?.managerHandoffReason || "";
  const selectedPaymentQuote = selectedBrief?.paymentQuote || "";
  const selectedLenderSummary = selectedBrief?.lenderSummary || "";
  const selectedNextAction = selectedBrief?.nextAction || "";
  const selectedLostReason = selectedBrief?.lostReason || "";

  useEffect(() => {
    if (!selectedBriefId) {
      return;
    }

    setAppointmentWindow(selectedAppointmentWindow);
    setManagerReason(selectedManagerReason);
    setPaymentQuote(selectedPaymentQuote);
    setLenderSummary(selectedLenderSummary);
    setNextAction(selectedNextAction);
    setLostReason(selectedLostReason);
    setNoteBody("");
    setStatusMessage(null);
  }, [
    selectedAppointmentWindow,
    selectedBriefId,
    selectedBriefUpdatedAt,
    selectedLenderSummary,
    selectedLostReason,
    selectedManagerReason,
    selectedNextAction,
    selectedPaymentQuote,
  ]);

  async function handleDealAction(
    action:
      | "BOOK_APPOINTMENT"
      | "COMPLETE_APPOINTMENT"
      | "SEND_TO_MANAGER"
      | "SEND_QUOTE"
      | "REQUEST_INFO"
      | "APPROVE_FINANCE"
      | "MARK_SOLD"
      | "MARK_LOST",
  ) {
    if (!selectedDeal || !selectedBrief) {
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const actorRole =
        action === "SEND_QUOTE" ||
        action === "REQUEST_INFO" ||
        action === "APPROVE_FINANCE" ||
        action === "MARK_SOLD"
          ? "MANAGER"
          : "SALESPERSON";
      const actorName =
        actorRole === "MANAGER" ? selectedBrief.managerName : selectedBrief.ownerName;

      await runSalesDealAction(selectedDeal.id, {
        action,
        actorName,
        actorRole,
        appointmentWindow: appointmentWindow || undefined,
        managerHandoffReason: managerReason || undefined,
        paymentQuote: paymentQuote || undefined,
        lenderSummary: lenderSummary || undefined,
        nextAction: nextAction || undefined,
        lostReason: lostReason || undefined,
      });

      setStatusMessage(
        action === "MARK_SOLD"
          ? "Deal marked sold and saved to the ledger."
          : action === "MARK_LOST"
            ? "Deal marked lost and archived in the ledger."
            : "Deal state updated and persisted.",
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to update the deal right now.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddNote() {
    if (!selectedDeal || !selectedBrief || !noteBody.trim()) {
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      await addSalesDealNote(selectedDeal.id, {
        actorName: selectedBrief.ownerName,
        actorRole: "SALESPERSON",
        body: noteBody,
      });

      setNoteBody("");
      setStatusMessage("Internal note saved to the deal record.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to save the note right now.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!selectedBrief || !selectedDeal || !selectedConversation) {
    return null;
  }

  const recentMessages = [...selectedConversation.messages]
    .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))
    .slice(0, 4);
  const recentHistory = [...selectedDeal.history]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 5);
  const stageIndex = getStageIndex(selectedDeal.stage);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              href="/test-lab"
            >
              Test lab
            </Link>
            <Link
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              href="/inbox"
            >
              Buyer inbox
            </Link>
            <Link
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:opacity-90"
              href="/setup"
            >
              Configure demo
              <ArrowUpRight size={16} />
            </Link>
          </>
        }
        description="A clearer sales workspace for the full deal flow: choose the buyer, understand the situation, move the deal forward, and review what automation or the manager changed."
        eyebrow="Sales workspace"
        title="Autonomous car salesman demo"
      />

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel
          action={<Badge tone="forest">Live system</Badge>}
          description="A guided view of how the salesperson, automation, and manager handoff work together from first message to close."
          title="Today at a glance"
        >
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[28px] border border-[var(--border)] bg-[linear-gradient(160deg,rgba(115,168,255,0.12),rgba(55,215,200,0.08),rgba(7,17,29,0.4))] p-5">
              <Badge tone="navy">How to use this page</Badge>
              <h2 className="mt-4 font-[family:var(--font-display)] text-3xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                Work one deal at a time.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted-foreground)]">
                Start in the priority queue, open the selected buyer, then use the controls below to push the visit, desk packet, or final finance status forward. The worker panel underneath shows what the autonomous system can already do on its own.
              </p>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {[
                  {
                    id: "pick",
                    label: "1. Pick",
                    detail: "Choose a live deal from the queue.",
                  },
                  {
                    id: "understand",
                    label: "2. Read",
                    detail: "See buyer goal, blocker, and current next step.",
                  },
                  {
                    id: "act",
                    label: "3. Act",
                    detail: "Use salesperson or desk controls to move the deal.",
                  },
                  {
                    id: "verify",
                    label: "4. Verify",
                    detail: "Watch conversation, history, and worker output update.",
                  },
                ].map((item) => (
                  <div
                    className="rounded-[22px] border border-[var(--border)] bg-[rgba(5,12,22,0.44)] p-4"
                    key={item.id}
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                      {item.label}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {snapshot.workflowSteps.map((step) => (
                <div
                  className="rounded-[22px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                  key={step.id}
                >
                  <Badge tone={step.tone}>{step.title}</Badge>
                  <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                    {step.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <StatCard
            change={`${snapshot.unreadLeadCount} waiting for a reply`}
            icon={<Users size={18} />}
            title="Open deals"
            tone="forest"
            value={snapshot.liveLeadCount.toString()}
          />
          <StatCard
            change={`${snapshot.appointmentReadyCount} have a visit path`}
            icon={<CalendarCheck2 size={18} />}
            title="Visits in motion"
            tone="navy"
            value={snapshot.appointmentReadyCount.toString()}
          />
          <StatCard
            change={`${snapshot.needsManagerCount} need desk attention`}
            icon={<CreditCard size={18} />}
            title="Desk packets"
            tone="danger"
            value={snapshot.financeHandoffCount.toString()}
          />
          <StatCard
            change="Stored in the live ledger"
            icon={<ShieldCheck size={18} />}
            title="Sold logged"
            tone="tan"
            value={snapshot.soldDealCount.toString()}
          />
        </div>
      </div>

      <AutonomousAgentPanel
        conversationId={selectedDeal.conversationId}
        customerName={selectedBrief.customerName}
      />

      <div className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <Panel
          action={<Badge tone="navy">Step 1</Badge>}
          description="Start here. The queue is sorted by urgency so you know which buyer should get your attention first."
          title="Deal list"
        >
          <div className="space-y-3">
            {activeDeals.map((deal) => (
              <button
                className={`w-full rounded-[24px] border p-4 text-left transition ${
                  selectedDealId === deal.id
                    ? "border-[var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-soft))]"
                    : "border-[var(--border)] bg-[var(--card-soft)] hover:border-[var(--accent)]"
                }`}
                key={deal.id}
                onClick={() =>
                  startTransition(() => {
                    setSelectedDealId(deal.id);
                  })
                }
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-semibold text-[var(--foreground)]">
                      {deal.customerName}
                    </p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {deal.vehicleLabel}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge tone={deal.stageTone}>{deal.stageLabel}</Badge>
                    <Badge tone={deal.priorityTone}>{deal.priorityLabel}</Badge>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone="slate">{deal.ownerName}</Badge>
                  <Badge tone={deal.managerPacketTone}>{deal.managerPacketLabel}</Badge>
                </div>

                <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                  {deal.nextAction}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                  Updated {formatDateTime(deal.lastUpdatedAt)}
                </p>
              </button>
            ))}
          </div>

          {closedDeals.length ? (
            <div className="mt-4 rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Closed deals
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {closedDeals.map((deal) => (
                  <button
                    className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)] transition hover:border-[var(--accent)]"
                    key={deal.id}
                    onClick={() =>
                      startTransition(() => {
                        setSelectedDealId(deal.id);
                      })
                    }
                    type="button"
                  >
                    {deal.customerName} | {deal.stageLabel}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel
          action={<Badge tone="forest">Step 2</Badge>}
          description="This is the live buyer context shared across the salesperson workflow, automation, and manager handoff."
          title="Deal details"
        >
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              {[
                {
                  label: "Buyer",
                  value: selectedBrief.customerName,
                },
                {
                  label: "Current stage",
                  value: selectedBrief.stageLabel,
                },
                {
                  label: "Visit status",
                  value: selectedBrief.appointmentStatusLabel,
                },
                {
                  label: "Desk packet",
                  value: selectedBrief.managerPacketLabel,
                },
              ].map((item) => (
                <div
                  className="rounded-[22px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                  key={item.label}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                    {item.label}
                  </p>
                  <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-[24px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(115,168,255,0.08),rgba(6,15,28,0.25))] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={selectedBrief.priorityTone}>{selectedBrief.priorityLabel}</Badge>
                <Badge tone={selectedBrief.managerPacketTone}>{selectedBrief.managerPacketLabel}</Badge>
              </div>
              <h2 className="mt-4 font-[family:var(--font-display)] text-3xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                {selectedBrief.vehicleLabel}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
                {selectedBrief.nextAction}
              </p>

              <div className="mt-5 grid gap-3 md:grid-cols-5">
                {stageSequence.map((stage, index) => {
                  const isComplete =
                    selectedDeal.stage === "SOLD" ? true : stageIndex >= index;
                  const isCurrent =
                    selectedDeal.stage !== "SOLD" &&
                    selectedDeal.stage !== "LOST" &&
                    stage.key === selectedDeal.stage;

                  return (
                    <div
                      className={`rounded-[18px] border px-3 py-3 text-center ${
                        isCurrent
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : isComplete
                            ? "border-[color:color-mix(in_srgb,var(--navy)_36%,transparent)] bg-[var(--navy-soft)]"
                            : "border-[var(--border)] bg-[rgba(255,255,255,0.02)]"
                      }`}
                      key={stage.key}
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                        {stage.label}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {[
                {
                  label: "Buyer goal",
                  value: selectedBrief.buyerGoal,
                },
                {
                  label: "Current blocker",
                  value: selectedBrief.objection,
                },
                {
                  label: "Finance read",
                  value: selectedBrief.financeSummary,
                },
                {
                  label: "Suggested reply",
                  value: selectedBrief.suggestedReply,
                },
              ].map((item) => (
                <div
                  className="rounded-[22px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                  key={item.label}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                    {item.label}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel
          action={<Badge tone="forest">Step 3</Badge>}
          description="Use these controls when you want to move the deal manually or speed up the next step."
          title="Deal actions"
        >
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
                <div className="flex items-center gap-2">
                  <CalendarCheck2 size={18} className="text-[var(--accent)]" />
                  <p className="font-semibold text-[var(--foreground)]">Salesperson lane</p>
                </div>
                <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
                  Use this side for visit setting, buyer guidance, and desk escalation.
                </p>

                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      Appointment window
                    </span>
                    <input
                      className={fieldClassName}
                      onChange={(event) => setAppointmentWindow(event.target.value)}
                      placeholder="Tomorrow at 10:00 AM"
                      value={appointmentWindow}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      Desk handoff reason
                    </span>
                    <textarea
                      className={`${fieldClassName} min-h-[100px] resize-y`}
                      onChange={(event) => setManagerReason(event.target.value)}
                      placeholder="Buyer is ready for numbers and trade evaluation."
                      value={managerReason}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      Next action
                    </span>
                    <textarea
                      className={`${fieldClassName} min-h-[100px] resize-y`}
                      onChange={(event) => setNextAction(event.target.value)}
                      placeholder="Hold the buyer warm while the desk builds numbers."
                      value={nextAction}
                    />
                  </label>

                  <div className="grid gap-2">
                    {salesActionButtons.map((button) => (
                      <button
                        className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-left transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSaving}
                        key={button.action}
                        onClick={() => void handleDealAction(button.action)}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-[var(--foreground)]">
                              {button.label}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                              {button.description}
                            </p>
                          </div>
                          <Badge tone={button.tone}>{button.label}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
                <div className="flex items-center gap-2">
                  <CircleDollarSign size={18} className="text-[var(--tan-strong)]" />
                  <p className="font-semibold text-[var(--foreground)]">Desk lane</p>
                </div>
                <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
                  Use this side when the manager has numbers, needs more info, or is ready to close the deal.
                </p>

                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      Payment quote
                    </span>
                    <input
                      className={fieldClassName}
                      onChange={(event) => setPaymentQuote(event.target.value)}
                      placeholder="$598/mo with $3,500 down"
                      value={paymentQuote}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      Lender summary
                    </span>
                    <textarea
                      className={`${fieldClassName} min-h-[100px] resize-y`}
                      onChange={(event) => setLenderSummary(event.target.value)}
                      placeholder="Tier-two approval with proof of income and trade payoff."
                      value={lenderSummary}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                      Lost reason
                    </span>
                    <input
                      className={fieldClassName}
                      onChange={(event) => setLostReason(event.target.value)}
                      placeholder="Went with another vehicle after payment objection."
                      value={lostReason}
                    />
                  </label>

                  <div className="grid gap-2">
                    {managerActionButtons.map((button) => (
                      <button
                        className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-left transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSaving}
                        key={button.action}
                        onClick={() => void handleDealAction(button.action)}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-[var(--foreground)]">
                              {button.label}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                              {button.description}
                            </p>
                          </div>
                          <Badge tone={button.tone}>{button.label}</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-[var(--accent)]" />
                <p className="font-semibold text-[var(--foreground)]">Internal note</p>
              </div>
              <label className="mt-4 block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                  Add context for the next operator
                </span>
                <textarea
                  className={`${fieldClassName} min-h-[120px] resize-y`}
                  onChange={(event) => setNoteBody(event.target.value)}
                  placeholder="Buyer mentioned a trade payoff and wants numbers before tonight."
                  value={noteBody}
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving || !noteBody.trim()}
                  onClick={() => void handleAddNote()}
                  type="button"
                >
                  Save note
                  <ArrowUpRight size={16} />
                </button>
                {statusMessage ? (
                  <p className="text-sm text-[var(--muted-foreground)]">{statusMessage}</p>
                ) : null}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          action={<Badge tone="navy">Step 4</Badge>}
          description="Use this area to confirm what changed in the buyer conversation and saved deal record."
          title="Recent activity"
        >
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
                <div className="flex items-center gap-2">
                  <Radar size={18} className="text-[var(--accent)]" />
                  <p className="font-semibold text-[var(--foreground)]">Latest conversation</p>
                </div>
                <div className="mt-4 space-y-3">
                  {recentMessages.map((message) => (
                    <div
                      className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-3"
                      key={message.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge
                          tone={
                            message.direction === "INBOUND"
                              ? "navy"
                              : message.direction === "OUTBOUND"
                                ? "forest"
                                : "slate"
                          }
                        >
                          {message.direction.replaceAll("_", " ")}
                        </Badge>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                          {formatDateTime(message.sentAt)}
                        </p>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                        {message.authorName}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[var(--foreground)]">
                        {message.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
                <div className="flex items-center gap-2">
                  <CheckCheck size={18} className="text-[var(--accent)]" />
                  <p className="font-semibold text-[var(--foreground)]">Latest ledger events</p>
                </div>
                <div className="mt-4 space-y-3">
                  {recentHistory.map((entry) => (
                    <div
                      className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-3"
                      key={entry.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge tone={entry.actorRole === "MANAGER" ? "danger" : "forest"}>
                          {entry.event.replaceAll("_", " ")}
                        </Badge>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                          {formatDateTime(entry.createdAt)}
                        </p>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                        {entry.actorName}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[var(--foreground)]">
                        {entry.message}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="forest">Recommended reply</Badge>
                <Badge tone="slate">Owner {selectedBrief.ownerName}</Badge>
                <Badge tone="navy">Desk {selectedBrief.managerName}</Badge>
              </div>
              <p className="mt-4 text-sm leading-7 text-[var(--foreground)]">
                {selectedBrief.suggestedReply}
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel
          action={<Badge tone="danger">{snapshot.financeHandoffCount} active</Badge>}
          description="These are the deals already mature enough for desk action."
          title="Manager handoffs"
        >
          <div className="space-y-3">
            {snapshot.managerHandoffs.length ? (
              snapshot.managerHandoffs.map((handoff) => (
                <button
                  className={`w-full rounded-[22px] border p-4 text-left transition ${
                    selectedDealId === handoff.dealId
                      ? "border-[var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-soft))]"
                      : "border-[var(--border)] bg-[var(--card-soft)] hover:border-[var(--accent)]"
                  }`}
                  key={handoff.id}
                  onClick={() =>
                    startTransition(() => {
                      setSelectedDealId(handoff.dealId);
                    })
                  }
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">
                        {handoff.customerName}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        {handoff.vehicleLabel}
                      </p>
                    </div>
                    <Badge tone={handoff.packetTone}>{handoff.packetLabel}</Badge>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                    {handoff.reason}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    {handoff.handoffAction}
                  </p>
                </button>
              ))
            ) : (
              <div className="rounded-[22px] border border-dashed border-[var(--border)] bg-[var(--card-soft)] p-4 text-sm leading-7 text-[var(--muted-foreground)]">
                No deals are waiting on the desk right now.
              </div>
            )}
          </div>
        </Panel>

        <Panel
          action={<Badge tone="navy">{snapshot.inventoryCount} units</Badge>}
          description="These are the best backup vehicles to save the conversation if the first-choice unit stalls."
          title="Alternative vehicles"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {snapshot.inventoryPlays.map((play) => (
              <div
                className="rounded-[22px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                key={play.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">
                      {play.vehicleLabel}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      Owner {play.ownerName}
                    </p>
                  </div>
                  <Badge tone={play.tone}>{play.fitLabel}</Badge>
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                  {play.action}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                  {play.reason}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
