"use client";

import { useEffect, useEffectEvent, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  CalendarCheck2,
  Clock3,
  MessageSquarePlus,
  RefreshCcw,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { DEFAULT_SALES_TENANT_ID } from "@/lib/autonomous-salesman";
import { formatDateTime, formatRelativeFromNow } from "@/lib/format";
import { refreshSalesFloor } from "@/lib/sales-floor-store";
import type {
  AgentTaskRecord,
  AgentWorkerSummary,
  OutboundMessageRecord,
  SalesAppointmentRecord,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

interface WorkerTasksResponse {
  ok: boolean;
  tasks: AgentTaskRecord[];
  lastRunSummary?: AgentWorkerSummary;
  error?: string;
}

interface AppointmentsResponse {
  ok: boolean;
  appointments: SalesAppointmentRecord[];
  error?: string;
}

interface OutboundMessagesResponse {
  ok: boolean;
  messages: OutboundMessageRecord[];
  error?: string;
}

const fieldClassName =
  "w-full rounded-[18px] border border-[var(--border)] bg-[var(--card-soft)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]";

async function parseWorkerResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | WorkerTasksResponse
    | { error?: string; message?: string }
    | null;

  if (!response.ok || !payload || !("tasks" in payload)) {
    const message =
      payload && "message" in payload ? payload.message : undefined;

    throw new Error(
      payload?.error ||
        message ||
        "Autonomous worker request failed. Refresh and try again.",
    );
  }

  return payload;
}

async function parseAppointmentsResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | AppointmentsResponse
    | { error?: string; message?: string }
    | null;

  if (!response.ok || !payload || !("appointments" in payload)) {
    const message =
      payload && "message" in payload ? payload.message : undefined;

    throw new Error(
      payload?.error ||
        message ||
        "Appointment book request failed. Refresh and try again.",
    );
  }

  return payload.appointments;
}

async function parseOutboundMessagesResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | OutboundMessagesResponse
    | { error?: string; message?: string }
    | null;

  if (!response.ok || !payload || !("messages" in payload)) {
    const message =
      payload && "message" in payload ? payload.message : undefined;

    throw new Error(
      payload?.error ||
        message ||
        "Outbound message request failed. Refresh and try again.",
    );
  }

  return payload.messages;
}

export function AutonomousAgentPanel({
  conversationId,
  customerName,
}: {
  conversationId?: string;
  customerName?: string;
}) {
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([]);
  const [appointments, setAppointments] = useState<SalesAppointmentRecord[]>([]);
  const [outboundMessages, setOutboundMessages] = useState<OutboundMessageRecord[]>([]);
  const [lastRunSummary, setLastRunSummary] = useState<AgentWorkerSummary>();
  const [simulatedMessage, setSimulatedMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function loadSupportingSnapshots() {
    const [appointmentsResponse, outboundMessagesResponse] = await Promise.all([
      fetch(`/api/tenants/${DEFAULT_SALES_TENANT_ID}/appointments`, {
        cache: "no-store",
      }),
      fetch(`/api/tenants/${DEFAULT_SALES_TENANT_ID}/outbound-messages`, {
        cache: "no-store",
      }),
    ]);
    const [nextAppointments, nextOutboundMessages] = await Promise.all([
      parseAppointmentsResponse(appointmentsResponse),
      parseOutboundMessagesResponse(outboundMessagesResponse),
    ]);

    setAppointments(nextAppointments);
    setOutboundMessages(nextOutboundMessages);
  }

  async function loadSnapshotNow() {
    const [workerResponse] = await Promise.all([
      fetch(`/api/tenants/${DEFAULT_SALES_TENANT_ID}/agent/tasks`, {
        cache: "no-store",
      }),
      loadSupportingSnapshots(),
    ]);
    const payload = await parseWorkerResponse(workerResponse);
    setTasks(payload.tasks);
    setLastRunSummary(payload.lastRunSummary);
  }

  async function runWorkerNow() {
    setIsRunning(true);

    try {
      const response = await fetch(
        `/api/tenants/${DEFAULT_SALES_TENANT_ID}/agent/run`,
        {
          method: "POST",
          cache: "no-store",
        },
      );
      const payload = await parseWorkerResponse(response);

      setTasks(payload.tasks);
      setLastRunSummary(payload.lastRunSummary);
      await Promise.all([loadSupportingSnapshots(), refreshSalesFloor()]);
      setStatusMessage("Worker ran and synced the latest live state.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to run the autonomous worker right now.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  const runWorkerTick = useEffectEvent(() => {
    void runWorkerNow();
  });
  const loadSnapshotTick = useEffectEvent(() => {
    void loadSnapshotNow();
  });

  useEffect(() => {
    loadSnapshotTick();
    runWorkerTick();

    const intervalId = window.setInterval(() => {
      runWorkerTick();
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function handleSimulateBuyerReply() {
    if (!conversationId || !simulatedMessage.trim()) {
      return;
    }

    setIsRunning(true);

    try {
      const response = await fetch(
        `/api/tenants/${DEFAULT_SALES_TENANT_ID}/conversations/${conversationId}/simulate-inbound`,
        {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            body: simulatedMessage,
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to simulate the buyer reply.");
      }

      setSimulatedMessage("");
      await runWorkerNow();
      await refreshSalesFloor();
      setStatusMessage("Buyer reply simulated and the worker processed it.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to simulate the buyer reply right now.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  const activeTasks = tasks.filter(
    (task) => task.status === "PENDING" || task.status === "RUNNING",
  );
  const recentTaskResults = tasks
    .filter((task) => task.status === "SUCCEEDED" || task.status === "FAILED")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 4);
  const upcomingAppointments = appointments
    .filter(
      (appointment) =>
        appointment.status === "BOOKED" || appointment.status === "CONFIRMED",
    )
    .slice(0, 4);
  const recentOutboundMessages = outboundMessages.slice(0, 4);

  return (
    <Panel
      action={<Badge tone="forest">Updates every minute</Badge>}
      description="This automation handles safe replies, follow-ups, appointment reminders, no-show rescue, and manager handoffs. Use this area to see what it can do, what it just changed, and what is coming next."
      title="Automation activity"
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-[var(--accent)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Last run
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {lastRunSummary ? formatDateTime(lastRunSummary.completedAt) : "Waiting"}
            </p>
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="flex items-center gap-2">
              <Workflow size={16} className="text-[var(--navy-strong)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Executed
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {lastRunSummary?.executedTasks || 0} task
              {lastRunSummary?.executedTasks === 1 ? "" : "s"}
            </p>
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="flex items-center gap-2">
              <ArrowUpRight size={16} className="text-[var(--accent)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Messages sent
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {lastRunSummary?.sentMessages || 0}
            </p>
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="flex items-center gap-2">
              <Clock3 size={16} className="text-[var(--tan-strong)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Queue
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {activeTasks.length} active task{activeTasks.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center gap-2">
              <CalendarCheck2 size={16} className="text-[var(--accent)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Visits booked
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {lastRunSummary?.bookedAppointments || 0}
            </p>
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center gap-2">
              <RefreshCcw size={16} className="text-[var(--navy-strong)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Reminders
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {lastRunSummary?.appointmentRemindersSent || 0}
            </p>
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center gap-2">
              <Clock3 size={16} className="text-[var(--tan-strong)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                No-shows
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {lastRunSummary?.noShowsMarked || 0}
            </p>
          </div>
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-[var(--accent)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Auto-approved
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
              {lastRunSummary?.autoApprovedPackets || 0}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              title: "Safe buyer replies",
              detail: "Answers availability and feature questions without human risk.",
              tone: "forest" as const,
            },
            {
              title: "Appointment lifecycle",
              detail: "Books visits, confirms them, and runs no-show rescue automatically.",
              tone: "navy" as const,
            },
            {
              title: "Desk packet logic",
              detail: "Creates manager packets and can auto-approve standard finance cases.",
              tone: "tan" as const,
            },
          ].map((item) => (
            <div
              className="rounded-[20px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
              key={item.title}
            >
              <Badge tone={item.tone}>{item.title}</Badge>
              <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                {item.detail}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRunning}
            onClick={() => void runWorkerNow()}
            type="button"
          >
            Run automation now
            <ArrowUpRight size={16} />
          </button>
          {statusMessage ? (
            <p className="text-sm text-[var(--muted-foreground)]">{statusMessage}</p>
          ) : null}
        </div>

        {conversationId ? (
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="flex items-center gap-2">
              <MessageSquarePlus size={18} className="text-[var(--navy-strong)]" />
              <p className="font-semibold text-[var(--foreground)]">
                Simulate buyer reply{customerName ? ` for ${customerName}` : ""}
              </p>
            </div>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
              Use this when you want to test the current deal without leaving the page.
            </p>
            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                Inbound message
              </span>
              <textarea
                className={`${fieldClassName} min-h-[110px] resize-y`}
                onChange={(event) => setSimulatedMessage(event.target.value)}
                placeholder="If the payment looks good, I can come by tonight."
                value={simulatedMessage}
              />
            </label>
            <div className="mt-3">
              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isRunning || !simulatedMessage.trim()}
                onClick={() => void handleSimulateBuyerReply()}
                type="button"
              >
                Send simulated reply
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-[var(--foreground)]">Upcoming tasks</p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  What the worker is about to do next.
                </p>
              </div>
              <Badge tone="navy">{activeTasks.length} queued</Badge>
            </div>

            <div className="mt-4 space-y-3">
              {activeTasks.length ? (
                activeTasks.slice(0, 4).map((task) => (
                  <div
                    className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-3"
                    key={task.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">
                          {task.title}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                          {task.reason}
                        </p>
                      </div>
                      <Badge tone={task.status === "RUNNING" ? "forest" : "tan"}>
                        {task.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                      Due {formatDateTime(task.scheduledFor)}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-7 text-[var(--muted-foreground)]">
                  No active tasks are waiting right now.
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Appointment book</p>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    Upcoming visits and rescue-sensitive appointments.
                  </p>
                </div>
                <Badge tone="forest">{upcomingAppointments.length} live</Badge>
              </div>

              <div className="mt-4 space-y-3">
                {upcomingAppointments.length ? (
                  upcomingAppointments.map((appointment) => (
                    <div
                      className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-3"
                      key={appointment.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--foreground)]">
                            {appointment.customerName}
                          </p>
                          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                            {appointment.vehicleLabel}
                          </p>
                        </div>
                        <Badge
                          tone={
                            appointment.status === "CONFIRMED" ? "forest" : "tan"
                          }
                        >
                          {appointment.status}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm text-[var(--foreground)]">
                        {appointment.windowLabel}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                        {formatDateTime(appointment.scheduledAt)} |{" "}
                        {formatRelativeFromNow(appointment.scheduledAt)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-7 text-[var(--muted-foreground)]">
                    No live appointments yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Sent messages</p>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    Most recent autonomous messages.
                  </p>
                </div>
                <Badge tone="navy">{outboundMessages.length} sent</Badge>
              </div>

              <div className="mt-4 space-y-3">
                {recentOutboundMessages.length ? (
                  recentOutboundMessages.map((message) => (
                    <div
                      className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-3"
                      key={message.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge tone="slate">{message.policyId.replaceAll("_", " ")}</Badge>
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                          {formatRelativeFromNow(message.sentAt)}
                        </p>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                        {message.body}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-7 text-[var(--muted-foreground)]">
                    No autonomous outbound messages yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-[var(--foreground)]">Recent automation results</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                The newest completed or failed worker actions.
              </p>
            </div>
            <Badge tone="slate">{recentTaskResults.length} shown</Badge>
          </div>

          <div className="mt-4 space-y-3">
            {recentTaskResults.length ? (
              recentTaskResults.map((task) => (
                <div
                  className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-3"
                  key={task.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">{task.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                        {task.reason}
                      </p>
                    </div>
                    <Badge tone={task.status === "SUCCEEDED" ? "forest" : "danger"}>
                      {task.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone="slate">{task.kind.replaceAll("_", " ")}</Badge>
                    <Badge tone="slate">
                      {task.completedAt
                        ? `Completed ${formatDateTime(task.completedAt)}`
                        : `Due ${formatDateTime(task.scheduledFor)}`}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[20px] border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-sm leading-7 text-[var(--muted-foreground)]">
                No finished tasks yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
