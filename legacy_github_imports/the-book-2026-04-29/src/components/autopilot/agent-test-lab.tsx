"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import {
  ArrowUpRight,
  FlaskConical,
  RotateCcw,
  SendHorizonal,
  Sparkles,
  Zap,
} from "lucide-react";

import { AutonomousAgentPanel } from "@/components/autopilot/autonomous-agent-panel";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_SALES_TENANT_ID } from "@/lib/autonomous-salesman";
import { refreshSalesFloor, useSalesFloor } from "@/lib/sales-floor-store";
import type { AgentWorkerSummary } from "@/lib/types";

const fieldClassName =
  "w-full rounded-[18px] border border-[var(--border)] bg-[var(--card-soft)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]";

const scenarioPresets = [
  {
    id: "availability",
    label: "Availability check",
    message: "Is this still available, and can you tell me if it is on the lot right now?",
    expected: "Usually triggers a safe informational reply.",
  },
  {
    id: "feature",
    label: "Feature question",
    message: "Does this one have the panoramic roof and heated seats?",
    expected: "Usually triggers a policy-safe answer without desk involvement.",
  },
  {
    id: "appointment",
    label: "Visit confirmation",
    message: "Tomorrow at 10 works for me. Please lock it in.",
    expected: "Should move the deal into the appointment flow.",
  },
  {
    id: "finance",
    label: "Finance intent",
    message: "If the payment stays around $550 a month, I can come by tonight and wrap this up.",
    expected: "Should open or advance the desk packet and may auto-approve.",
  },
  {
    id: "red-flag",
    label: "Credit red flag",
    message: "I had a repo last year and I am upside down on my trade. Can you still help?",
    expected: "Should avoid auto-approval and leave the human desk in control.",
  },
] as const;

interface WorkerRunResponse {
  ok: boolean;
  lastRunSummary?: AgentWorkerSummary;
  error?: string;
}

export function AgentTestLab() {
  const salesFloor = useSalesFloor();
  const activeDeals = salesFloor.deals.filter(
    (deal) => deal.stage !== "SOLD" && deal.stage !== "LOST",
  );
  const [selectedDealId, setSelectedDealId] = useState(activeDeals[0]?.id);
  const [buyerMessage, setBuyerMessage] = useState("");
  const [lastRunSummary, setLastRunSummary] = useState<AgentWorkerSummary>();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!activeDeals.length) {
      return;
    }

    if (!selectedDealId || !activeDeals.some((deal) => deal.id === selectedDealId)) {
      startTransition(() => {
        setSelectedDealId(activeDeals[0]?.id);
      });
    }
  }, [activeDeals, selectedDealId]);

  const selectedDeal =
    salesFloor.deals.find((deal) => deal.id === selectedDealId) || activeDeals[0];
  const selectedConversation = salesFloor.conversations.find(
    (conversation) => conversation.id === selectedDeal?.conversationId,
  );

  async function runWorkerNow() {
    const response = await fetch(
      `/api/tenants/${DEFAULT_SALES_TENANT_ID}/agent/run`,
      {
        method: "POST",
        cache: "no-store",
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | WorkerRunResponse
      | { error?: string; message?: string }
      | null;

    if (!response.ok || !payload || !("ok" in payload) || !payload.ok) {
      const message =
        payload && "message" in payload ? payload.message : undefined;
      throw new Error(
        payload?.error || message || "Unable to run the autonomous worker.",
      );
    }

    setLastRunSummary(payload.lastRunSummary);
    return payload.lastRunSummary;
  }

  async function sendBuyerMessage(message: string) {
    if (!selectedConversation || !message.trim()) {
      return;
    }

    const response = await fetch(
      `/api/tenants/${DEFAULT_SALES_TENANT_ID}/conversations/${selectedConversation.id}/simulate-inbound`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: message.trim(),
        }),
      },
    );

    const payload = (await response.json().catch(() => null)) as
      | { ok: boolean; error?: string; message?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Unable to simulate the buyer message.");
    }
  }

  async function handleRunScenario(message: string) {
    if (!selectedConversation) {
      return;
    }

    setIsBusy(true);
    setStatusMessage(null);

    try {
      await sendBuyerMessage(message);
      const summary = await runWorkerNow();
      await refreshSalesFloor();

      setBuyerMessage("");
      setStatusMessage(
        summary?.executedTasks
          ? `Scenario sent. The worker executed ${summary.executedTasks} task${summary.executedTasks === 1 ? "" : "s"} and sent ${summary.sentMessages} message${summary.sentMessages === 1 ? "" : "s"}.`
          : "Scenario sent. The worker scanned the deal, but nothing new fired yet.",
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to run the scenario right now.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function handleFreeformSend() {
    if (!buyerMessage.trim()) {
      return;
    }

    await handleRunScenario(buyerMessage);
  }

  async function handleResetLab() {
    setIsBusy(true);
    setStatusMessage(null);

    try {
      const response = await fetch(
        `/api/tenants/${DEFAULT_SALES_TENANT_ID}/test-lab/reset`,
        {
          method: "POST",
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; error?: string; message?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to reset the demo lab.");
      }

      await refreshSalesFloor();
      setLastRunSummary(undefined);
      setBuyerMessage("");
      setStatusMessage("Demo lab reset to the seeded buyer and deal state.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to reset the demo lab right now.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  if (!selectedDeal || !selectedConversation) {
    return null;
  }

  const recentMessages = [...selectedConversation.messages]
    .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            <button
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
              onClick={() => void handleResetLab()}
              type="button"
            >
              <RotateCcw size={16} />
              Reset demo
            </button>
            <Link
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:opacity-90"
              href="/"
            >
              Open command center
              <ArrowUpRight size={16} />
            </Link>
          </>
        }
        description="Use this demo lab to test how the sales agent reacts. Pick a deal, send a buyer message, and watch the conversation, automation, appointments, and handoff state update."
        eyebrow="Demo testing"
        title="Sales agent demo lab"
      />

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel
          action={<Badge tone="forest">Guided flow</Badge>}
          description="Use the lab in this order so the demo stays easy to read."
          title="How this demo works"
        >
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                id: "pick",
                label: "1. Pick a deal",
                detail: "Choose the buyer thread you want to pressure-test.",
              },
              {
                id: "send",
                label: "2. Send a scenario",
                detail: "Use a canned scenario or your own buyer message.",
              },
              {
                id: "inspect",
                label: "3. Inspect the reaction",
                detail: "Read the transcript, worker panel, and resulting deal state.",
              },
            ].map((item) => (
              <div
                className="rounded-[22px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
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
        </Panel>

        <Panel
          action={<Badge tone="navy">{selectedDeal.stage.replaceAll("_", " ")}</Badge>}
          description="This is the live deal state the worker sees before it decides what to do."
          title="Selected deal"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {[
              {
                label: "Customer",
                value: selectedDeal.customerName,
              },
              {
                label: "Vehicle",
                value: selectedDeal.vehicleLabel,
              },
              {
                label: "Visit window",
                value: selectedDeal.appointmentWindow || "No visit locked yet.",
              },
              {
                label: "Desk packet",
                value: selectedDeal.managerPacketStatus.replaceAll("_", " "),
              },
              {
                label: "Next action",
                value: selectedDeal.nextAction,
              },
              {
                label: "Last worker run",
                value: lastRunSummary
                  ? formatDateTime(lastRunSummary.completedAt)
                  : "Run a scenario to generate fresh output.",
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
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel
          action={<Badge tone="forest">Run scenarios</Badge>}
          description="These canned prompts are tuned to trigger the most important branches of the demo."
          title="Run a scenario"
        >
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Active deal
              </span>
              <select
                className={fieldClassName}
                onChange={(event) => setSelectedDealId(event.target.value)}
                value={selectedDeal.id}
              >
                {activeDeals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.customerName} | {deal.vehicleLabel}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-2">
              {scenarioPresets.map((scenario) => (
                <button
                  className="rounded-[20px] border border-[var(--border)] bg-[var(--card-soft)] px-4 py-4 text-left transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isBusy}
                  key={scenario.id}
                  onClick={() => void handleRunScenario(scenario.message)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">
                        {scenario.label}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[var(--foreground)]">
                        {scenario.message}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                        Expectation: {scenario.expected}
                      </p>
                    </div>
                    <Badge tone="navy">Run</Badge>
                  </div>
                </button>
              ))}
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Freeform buyer message
              </span>
              <textarea
                className={`${fieldClassName} min-h-[140px] resize-y`}
                onChange={(event) => setBuyerMessage(event.target.value)}
                placeholder="If the numbers work, I can be there tonight after work."
                value={buyerMessage}
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy || !buyerMessage.trim()}
                onClick={() => void handleFreeformSend()}
                type="button"
              >
                Send and run worker
                <SendHorizonal size={16} />
              </button>
              {statusMessage ? (
                <p className="text-sm text-[var(--muted-foreground)]">{statusMessage}</p>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel
          action={<Badge tone="tan">What to watch</Badge>}
          description="This checklist makes the worker response easier to interpret."
          title="What changes after each run"
        >
          <div className="space-y-3">
            {[
              {
                icon: <FlaskConical size={16} />,
                title: "Transcript movement",
                detail: "Check whether the worker added an outbound message or moved the buyer to the next step.",
              },
              {
                icon: <Zap size={16} />,
                title: "Worker summary",
                detail: "Look for executed tasks, sent messages, booked visits, or auto-approved packets.",
              },
              {
                icon: <Sparkles size={16} />,
                title: "Deal-state change",
                detail: "Watch the stage, appointment status, and manager packet status update after each run.",
              },
            ].map((item) => (
              <div
                className="rounded-[22px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                key={item.title}
              >
                <div className="flex items-center gap-2 text-[var(--accent)]">
                  {item.icon}
                  <p className="font-semibold text-[var(--foreground)]">{item.title}</p>
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <AutonomousAgentPanel
        conversationId={selectedConversation.id}
        customerName={selectedDeal.customerName}
      />

      <Panel
        action={<Badge tone="navy">{selectedConversation.messages.length} messages</Badge>}
        description="Newest messages are on top so you can immediately see what the buyer said and how the agent responded."
        title="Conversation transcript"
      >
        <div className="space-y-3">
          {recentMessages.map((message) => (
            <div
              className={`rounded-[22px] border p-4 ${
                message.direction === "INBOUND"
                  ? "border-[color:color-mix(in_srgb,var(--navy)_30%,transparent)] bg-[var(--navy-soft)]"
                  : message.direction === "OUTBOUND"
                    ? "border-[color:color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] bg-[var(--card-soft)]"
              }`}
              key={message.id}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
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
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {message.authorName}
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                  {formatDateTime(message.sentAt)}
                </p>
              </div>
              <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                {message.body}
              </p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
