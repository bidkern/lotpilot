"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatRelativeFromNow } from "@/lib/format";
import type { ConversationRecord, EmployeeRecord } from "@/lib/types";

export function InboxBoard({
  conversations,
  employees,
}: {
  conversations: ConversationRecord[];
  employees: EmployeeRecord[];
}) {
  const [selectedConversationId, setSelectedConversationId] = useState(
    conversations[0]?.id,
  );

  const employeeNameById = Object.fromEntries(
    employees.map((employee) => [employee.id, employee.displayName]),
  );

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <p className="font-[family:var(--font-display)] text-xl font-semibold tracking-[-0.04em]">
            Recent conversations
          </p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Bucketed by last activity and unread urgency.
          </p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {conversations.map((conversation) => (
            <button
              className={`flex w-full flex-col gap-3 px-5 py-4 text-left transition ${
                selectedConversationId === conversation.id
                  ? "bg-[var(--accent-soft)]"
                  : "hover:bg-[color:color-mix(in_srgb,var(--foreground)_2%,transparent)]"
              }`}
              key={conversation.id}
              onClick={() => setSelectedConversationId(conversation.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-[var(--foreground)]">
                    {conversation.customerName}
                  </p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {conversation.vehicleLabel}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                    {formatRelativeFromNow(conversation.lastMessageAt)}
                  </p>
                  {conversation.unreadCount > 0 ? (
                    <p className="mt-1 text-sm font-semibold text-[var(--accent)]">
                      {conversation.unreadCount} unread
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  tone={conversation.escalated ? "tan" : "forest"}
                >
                  {conversation.status.replaceAll("_", " ")}
                </Badge>
                <Badge tone="slate">
                  {employeeNameById[conversation.assignedMembershipId]}
                </Badge>
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">
                {conversation.lastPreview}
              </p>
            </button>
          ))}
        </div>
      </div>

      {selectedConversation ? (
        <div className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
          <div className="border-b border-[var(--border)] px-5 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-[family:var(--font-display)] text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {selectedConversation.customerName}
                </p>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {selectedConversation.vehicleLabel}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="navy">
                  Owner: {employeeNameById[selectedConversation.assignedMembershipId]}
                </Badge>
                {selectedConversation.escalated ? (
                  <Badge tone="tan">Escalated</Badge>
                ) : null}
                <Badge tone="forest">
                  {selectedConversation.notesCount} note
                  {selectedConversation.notesCount === 1 ? "" : "s"}
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-5 py-5">
            {selectedConversation.messages.map((message) => {
              const isNote = message.direction === "INTERNAL_NOTE";
              const isInbound = message.direction === "INBOUND";

              return (
                <div
                  className={`max-w-3xl rounded-[24px] border px-4 py-4 ${
                    isNote
                      ? "border-[var(--tan)] bg-[var(--tan-soft)]"
                      : isInbound
                        ? "border-[var(--border)] bg-[var(--card-soft)]"
                        : "ml-auto border-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] bg-[var(--accent-soft)]"
                  }`}
                  key={message.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {message.authorName}
                    </p>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
                      {formatDateTime(message.sentAt)}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
                    {message.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
