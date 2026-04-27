"use client";

import type { getDashboardData } from "@/lib/services/inventory-service";
import { BadgeAlert, Bot, LoaderCircle, MessageSquare, PlugZap } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { formatDateLabel } from "@/lib/marketplace";
import { MetaConnectButton } from "@/components/meta-connect-button";

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
type MessagingData = DashboardData["messaging"];
type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT";

const roleRank: Record<UserRole, number> = {
  ADMIN: 3,
  AGENT: 1,
  MANAGER: 2,
  OWNER: 4,
};

function hasRole(role: UserRole, minimumRole: UserRole) {
  return roleRank[role] >= roleRank[minimumRole];
}

function badgeClass(status: string) {
  switch (status) {
    case "ACTIVE":
    case "COMPLETED":
    case "OPEN":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "PENDING":
    case "ACTION_REQUIRED":
    case "NEEDS_HUMAN":
    case "IN_PROGRESS":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "ERROR":
    case "DISCONNECTED":
    case "DISMISSED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
  }
}

function trimText(value: string | null | undefined, maxLength = 140) {
  if (!value) {
    return "No recent message preview yet.";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

type MessagingWorkspacePanelProps = {
  connectHref?: string;
  connectMode?: "link" | "popup";
  messaging: MessagingData;
  messagesHref?: string;
  role: UserRole;
};

export function MessagingWorkspacePanel({
  connectHref = "/api/admin/meta/connect",
  connectMode = "link",
  messaging,
  messagesHref,
  role,
}: MessagingWorkspacePanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busyPageId, setBusyPageId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canConnect = hasRole(role, "AGENT");
  const primaryConnection = messaging.primaryConnection;

  const urlMessage = useMemo(() => {
    const error = searchParams.get("messagingError");
    if (error) {
      return {
        text: error,
        tone: "error" as const,
      };
    }

    const status = searchParams.get("messagingStatus");
    if (status === "connected") {
      return {
        text: "Facebook Page connected successfully.",
        tone: "success" as const,
      };
    }

    if (status === "select-page") {
      return {
        text: "Choose which Facebook Page should power automated replies for this workspace.",
        tone: "info" as const,
      };
    }

    return null;
  }, [searchParams]);

  async function selectPage(metaAuthAccountId: string, pageId: string) {
    setBusyPageId(pageId);
    setMessage("Activating Facebook Page...");

    try {
      const response = await fetch("/api/admin/meta/select-page", {
        body: JSON.stringify({
          metaAuthAccountId,
          pageId,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to activate that Facebook Page.");
      }

      setMessage("Facebook Page connected. Messenger replies are now ready.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to activate that Facebook Page.");
    } finally {
      setBusyPageId(null);
    }
  }

  const subscriptionBadge = messaging.subscription ? badgeClass(messaging.subscription.status) : "border-zinc-200 bg-zinc-100 text-zinc-700";

  return (
    <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
            Messenger Connector
          </p>
          <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            Facebook Page inbox automation
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Dealers connect a Facebook Page, inbound Messenger conversations land in this
            workspace, and low-confidence replies fall back to human handoff.
          </p>
        </div>

        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--foreground)]">
          <PlugZap className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Subscription</p>
          {messaging.subscription ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${subscriptionBadge}`}>
                  {messaging.subscription.status}
                </span>
                <span className="text-sm text-[var(--muted)]">{messaging.subscription.planKey}</span>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">
                Trial ends {formatDateLabel(messaging.subscription.trialEndsAt)}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              No subscription record yet. Messaging stays disabled until trial or billing is active.
            </p>
          )}
        </article>

        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Open handoffs</p>
            <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
              {messaging.openHandoffs}
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Conversations currently waiting on a human response.
            </p>
          </article>

        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Connected accounts</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
            {messaging.accounts.length}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {messaging.connections.length} Facebook Page destination(s) are currently linked to this workspace.
          </p>
        </article>
      </div>

      {urlMessage || message ? (
        <div
          className={`mt-4 rounded-[20px] border px-4 py-3 text-sm ${
            (urlMessage?.tone ?? "info") === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-[var(--line)] bg-white/82 text-[var(--foreground)]"
          }`}
        >
          {message || urlMessage?.text}
        </div>
      ) : null}

      <div className="mt-4 rounded-[24px] border border-[var(--line)] bg-[rgba(17,40,46,0.92)] px-4 py-4 text-sm leading-6 text-white/82">
        Supported workflow: connect a Facebook Page, receive Messenger webhooks, store
        conversations in the tenant workspace, send inventory-aware replies, and escalate sensitive
        questions to staff. Unsupported workflow: logging into a personal Facebook profile or
        promising guaranteed Marketplace auto-posting.
      </div>

      <div className="mt-4 rounded-[24px] border border-[var(--line)] bg-white/82 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Connection</p>
            <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
              {primaryConnection?.pageName || "No Facebook Page connected yet"}
            </p>
          </div>

          {canConnect ? (
            connectMode === "popup" ? (
              <MetaConnectButton className="px-4 py-2" />
            ) : (
              <Link
                className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92"
                href={connectHref}
              >
                <Bot className="h-4 w-4" />
                {messaging.accounts.length ? "Connect another account" : "Connect Facebook"}
              </Link>
            )
          ) : null}
        </div>

        {primaryConnection ? (
          <div className="mt-4 space-y-3 text-sm text-[var(--muted)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(primaryConnection.status)}`}>
                {primaryConnection.status}
              </span>
              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                AI replies {primaryConnection.aiRepliesEnabled ? "enabled" : "disabled"}
              </span>
              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                Human handoff {primaryConnection.humanHandoffEnabled ? "enabled" : "disabled"}
              </span>
              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                Publication {primaryConnection.postingEnabled ? "enabled" : "disabled"}
              </span>
            </div>
            <p>Last webhook: {formatDateLabel(primaryConnection.lastWebhookAt)}</p>
            <p>Last message: {formatDateLabel(primaryConnection.lastMessageAt)}</p>
            <p>Last publication prep: {formatDateLabel(primaryConnection.lastPublishedAt)}</p>
            {primaryConnection.pageUsername ? (
              <p>Page username: @{primaryConnection.pageUsername}</p>
            ) : null}
            {primaryConnection.errorText ? (
              <div className="flex items-start gap-2 rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <BadgeAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{primaryConnection.errorText}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Connect a Facebook Page after tenant signup and subscription verification. Messenger
            replies stay scoped to this dealership workspace only.
          </p>
        )}

        {messaging.connections.length ? (
          <div className="mt-4 rounded-[20px] border border-[var(--line)] bg-[rgba(247,242,235,0.8)] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Connected Pages</p>
            <div className="mt-3 space-y-3">
              {messaging.connections.map((connection) => (
                <div
                  className="rounded-[18px] border border-[var(--line)] bg-white/82 px-3 py-3"
                  key={connection.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">{connection.pageName || "Unnamed Page"}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {connection.pageUsername ? `@${connection.pageUsername}` : "No public username"}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(connection.status)}`}>
                      {connection.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canConnect && messaging.accounts.length ? (
          <div className="mt-4 rounded-[20px] border border-[var(--line)] bg-[rgba(247,242,235,0.8)] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Connected Facebook Accounts</p>
            <div className="mt-3 space-y-3">
              {messaging.accounts.map((account) => (
                <div className="rounded-[18px] border border-[var(--line)] bg-white/82 px-3 py-3" key={account.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">
                        {account.displayName || account.facebookUserId}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {account.availablePages.length} available Page(s)
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(account.status)}`}>
                      {account.status}
                    </span>
                  </div>

                  {account.availablePages.length ? (
                    <div className="mt-3 space-y-3">
                      {account.availablePages.map((page) => (
                        <div
                          className="flex items-center justify-between gap-3 rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.65)] px-3 py-3"
                          key={page.id}
                        >
                          <div>
                            <p className="font-semibold text-[var(--foreground)]">{page.name}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {page.username ? `@${page.username}` : "No public username"}
                              {page.category ? ` | ${page.category}` : ""}
                            </p>
                          </div>
                          <button
                            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={busyPageId === page.id}
                            onClick={() => selectPage(account.id, page.id)}
                            type="button"
                          >
                            {busyPageId === page.id ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <PlugZap className="h-4 w-4" />
                            )}
                            Use this Page
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-[24px] border border-[var(--line)] bg-white/82 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Conversation Inbox</p>
            <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
              Recent customer conversations
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--foreground)]">
              <MessageSquare className="h-4 w-4" />
              {messaging.recentConversations.length} tracked
            </div>
            {messagesHref ? (
              <Link
                className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-3 py-1 text-xs font-semibold text-white transition hover:opacity-92"
                href={messagesHref}
              >
                Open inbox
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {messaging.recentConversations.length ? (
            messaging.recentConversations.map((conversation) => (
              <article className="rounded-[20px] border border-[var(--line)] bg-[rgba(247,242,235,0.72)] p-4" key={conversation.id}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">
                      {conversation.customerName || conversation.customerPsid}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Last message {formatDateLabel(conversation.lastMessageAt)}
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(conversation.status)}`}>
                    {conversation.status}
                  </span>
                </div>

                {conversation.vehicle ? (
                  <p className="mt-3 text-sm text-[var(--foreground)]">
                    Vehicle: {conversation.vehicle.title}
                  </p>
                ) : null}

                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {trimText(conversation.lastMessageText)}
                </p>

                {conversation.latestHandoffTask ? (
                  <div className="mt-3 rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Handoff: {conversation.latestHandoffTask.reason}
                  </div>
                ) : null}

                {conversation.lastAiConfidence !== null ? (
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    Last reply confidence {Math.round(conversation.lastAiConfidence * 100)}%
                  </p>
                ) : null}
              </article>
            ))
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No Messenger conversations yet. Once a Page is connected, inbound messages will land
              here and route into the tenant-safe inbox.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
