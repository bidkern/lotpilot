"use client";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SetupRequired } from "@/components/setup/setup-required";
import {
  getChildDisplayName,
  getFacebookConnectionByChildId,
} from "@/lib/workspace-derived";
import { useWorkspace } from "@/lib/workspace-store";

export default function InboxPage() {
  const workspace = useWorkspace();
  const connectedAccounts = workspace.childAccounts.filter((account) => {
    const connection = getFacebookConnectionByChildId(workspace, account.id);
    return connection?.status === "CONNECTED";
  });

  if (!workspace.parentAccount || connectedAccounts.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Employees work from a recent-conversations bucket. This starter keeps the inbox empty until you attach Facebook to your own child accounts."
          eyebrow="Inbox"
          title="Customer conversation bucket"
        />
        <SetupRequired
          description="Attach Facebook to at least one child account before testing inbox behavior."
          title="Inbox setup is not ready yet"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Employees work from a recent-conversations bucket. The workspace shows only the inbox lanes you have actually prepared."
        eyebrow="Inbox"
        title="Customer conversation bucket"
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          action={<Badge tone="forest">Official path</Badge>}
          description="Use this lane only when Meta grants approved Page permissions."
          title="Page API inbox"
        >
          <p className="text-sm leading-7 text-[var(--muted-foreground)]">
            Once official Page messaging is connected, live conversations, unread
            counts, assignment ownership, and reply actions will render here.
          </p>
        </Panel>

        <Panel
          action={<Badge tone="tan">Human assisted</Badge>}
          description="Marketplace messaging should stay human-in-the-loop unless an officially supported integration exists."
          title="Marketplace assisted inbox"
        >
          <p className="text-sm leading-7 text-[var(--muted-foreground)]">
            This lane will hold recent thread summaries, internal notes,
            escalation state, and draft responses while the employee replies in
            Facebook itself.
          </p>
        </Panel>
      </div>

      <Panel
        action={<Badge tone="navy">{connectedAccounts.length} ready</Badge>}
        description="These are the child accounts currently prepared for Facebook-connected messaging workflows."
        title="Connected accounts"
      >
        <div className="space-y-3">
          {connectedAccounts.map((account) => {
            const connection = getFacebookConnectionByChildId(workspace, account.id);

            return (
              <div
                className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                key={account.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">
                      {getChildDisplayName(account)}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {account.email}
                    </p>
                  </div>
                  <Badge tone="forest">{connection?.status || "CONNECTED"}</Badge>
                </div>
                <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                  {connection?.accountLabel || "Facebook account"}
                </p>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
