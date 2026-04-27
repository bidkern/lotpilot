"use client";

import { MessageCircleMore, MessagesSquare } from "lucide-react";
import { useMemo, useState } from "react";

import { formatDateLabel } from "@/lib/marketplace";

type InboxConversation = {
  assignedTo: {
    email: string;
    id: string;
    name: string | null;
  } | null;
  customerName: string | null;
  customerPsid: string;
  handoffReason: string | null;
  id: string;
  lastAiConfidence: number | null;
  lastInboundAt: string | null;
  lastMessageAt: string;
  lastOutboundAt: string | null;
  latestHandoffTask: {
    assignedTo: {
      email: string;
      id: string;
      name: string | null;
    } | null;
    createdAt: string;
    id: string;
    reason: string;
    status: string;
  } | null;
  messageCount: number;
  messages: Array<{
    authorType: string;
    direction: string;
    errorText: string | null;
    id: string;
    sentAt: string;
    text: string | null;
  }>;
  page: {
    id: string;
    name: string | null;
    status: string;
    username: string | null;
  };
  status: string;
  vehicle: {
    id: string;
    title: string;
  } | null;
};

type ConversationInboxProps = {
  conversations: InboxConversation[];
  currentUser: {
    email?: string | null;
    id: string;
    name?: string | null;
    role: string;
  };
  tenantName: string;
};

function trimText(value: string | null | undefined, maxLength = 120) {
  if (!value) {
    return "No message preview yet.";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function badgeClass(status: string) {
  switch (status) {
    case "OPEN":
    case "ACTIVE":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "NEEDS_HUMAN":
    case "IN_PROGRESS":
    case "PENDING":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "DISMISSED":
    case "ERROR":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

export function ConversationInbox({
  conversations,
  currentUser,
  tenantName,
}: ConversationInboxProps) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    conversations[0]?.id ?? null,
  );

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0] ?? null,
    [activeConversationId, conversations],
  );

  return (
    <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              {tenantName}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
              Your inbox
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Signed in as {currentUser.name || currentUser.email || currentUser.id}.
            </p>
          </div>
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--foreground)]">
            <MessagesSquare className="h-5 w-5" />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {conversations.length ? (
            conversations.map((conversation) => {
              const latestMessage = conversation.messages[conversation.messages.length - 1];
              const isActive = conversation.id === activeConversation?.id;

              return (
                <button
                  className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                    isActive
                      ? "border-[var(--foreground)] bg-[rgba(10,18,24,0.92)] text-white shadow-[0_16px_36px_rgba(11,20,28,0.18)]"
                      : "border-[var(--line)] bg-white/82 text-[var(--foreground)] hover:border-[var(--foreground)]"
                  }`}
                  key={conversation.id}
                  onClick={() => setActiveConversationId(conversation.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {conversation.customerName || conversation.customerPsid}
                      </p>
                      <p className={`mt-1 text-xs ${isActive ? "text-white/70" : "text-[var(--muted)]"}`}>
                        {formatDateLabel(conversation.lastMessageAt)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                        isActive ? "border-white/20 bg-white/10 text-white" : badgeClass(conversation.status)
                      }`}
                    >
                      {conversation.status}
                    </span>
                  </div>

                  <p className={`mt-3 text-sm leading-6 ${isActive ? "text-white/82" : "text-[var(--muted)]"}`}>
                    {trimText(latestMessage?.text)}
                  </p>

                  <div className={`mt-3 flex flex-wrap gap-2 text-[11px] font-semibold ${isActive ? "text-white/70" : "text-[var(--muted)]"}`}>
                    <span>{conversation.messageCount} messages</span>
                    {conversation.vehicle ? <span>{conversation.vehicle.title}</span> : null}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-[22px] border border-[var(--line)] bg-white/82 px-4 py-5 text-sm text-[var(--muted)]">
              No conversations are available for this inbox yet.
            </div>
          )}
        </div>
      </aside>

      <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
        {activeConversation ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Conversation detail
                </p>
                <h3 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                  {activeConversation.customerName || activeConversation.customerPsid}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {activeConversation.vehicle
                    ? `Vehicle context: ${activeConversation.vehicle.title}.`
                    : "No vehicle has been linked to this conversation yet."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(activeConversation.status)}`}>
                  {activeConversation.status}
                </span>
                <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                  Page {activeConversation.page.name || "Unknown"}
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Assigned to</p>
                <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                  {activeConversation.assignedTo?.name ||
                    activeConversation.assignedTo?.email ||
                    "Unassigned"}
                </p>
              </article>
              <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Last inbound</p>
                <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                  {formatDateLabel(activeConversation.lastInboundAt)}
                </p>
              </article>
              <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Last outbound</p>
                <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                  {formatDateLabel(activeConversation.lastOutboundAt)}
                </p>
              </article>
              <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">AI confidence</p>
                <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                  {activeConversation.lastAiConfidence !== null
                    ? `${Math.round(activeConversation.lastAiConfidence * 100)}%`
                    : "Not scored"}
                </p>
              </article>
            </div>

            {activeConversation.latestHandoffTask ? (
              <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                <p className="font-semibold">Handoff in progress</p>
                <p className="mt-2">{activeConversation.latestHandoffTask.reason}</p>
              </div>
            ) : null}

            <div className="mt-5 space-y-3">
              {activeConversation.messages.map((message) => {
                const isInbound = message.direction === "INBOUND";

                return (
                  <article
                    className={`max-w-3xl rounded-[24px] border px-4 py-4 shadow-[0_10px_26px_rgba(16,24,18,0.06)] ${
                      isInbound
                        ? "border-[var(--line)] bg-white/82 text-[var(--foreground)]"
                        : "ml-auto border-[rgba(231,212,165,0.24)] bg-[rgba(10,18,24,0.94)] text-white"
                    }`}
                    key={message.id}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
                      <span>{isInbound ? "Customer" : "Team / AI"}</span>
                      <span className={isInbound ? "text-[var(--muted)]" : "text-white/70"}>
                        {formatDateLabel(message.sentAt)}
                      </span>
                    </div>
                    <p className={`mt-3 text-sm leading-7 ${isInbound ? "text-[var(--foreground)]" : "text-white"}`}>
                      {message.text || "No text body was stored for this message."}
                    </p>
                    {message.errorText ? (
                      <p className={`mt-3 text-xs ${isInbound ? "text-rose-700" : "text-white/70"}`}>
                        Delivery note: {message.errorText}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex min-h-[340px] items-center justify-center rounded-[24px] border border-[var(--line)] bg-white/82 px-6 py-12 text-center">
            <div>
              <MessageCircleMore className="mx-auto h-10 w-10 text-[var(--muted)]" />
              <p className="mt-4 text-lg font-semibold text-[var(--foreground)]">
                No message thread selected
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Once customer conversations arrive, each thread will appear here with a full message
                history for the signed-in user.
              </p>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
