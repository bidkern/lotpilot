"use client";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SetupRequired } from "@/components/setup/setup-required";
import { JOB_NAME_LIST } from "@/lib/job-names";
import { useWorkspace } from "@/lib/workspace-store";

export default function QueuePage() {
  const workspace = useWorkspace();
  const connectedFacebookCount = workspace.facebookConnections.filter(
    (connection) => connection.status === "CONNECTED",
  ).length;

  if (!workspace.parentAccount || workspace.childAccounts.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Queue work is explicit, observable, and compliant. The UI is ready, but it stays empty until you build the workspace around your own accounts."
          eyebrow="Publishing queue"
          title="Assisted listing operations"
        />
        <SetupRequired
          description="Create the parent account and at least one child account before queue-driven listing work can start."
          title="Queue setup is not ready yet"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Queue work is explicit, observable, and compliant. This starter keeps the lane empty until your own inventory, assignments, and Facebook connections exist."
        eyebrow="Publishing queue"
        title="Assisted listing operations"
      />

      <Panel
        action={<Badge tone="tan">Policy-aware</Badge>}
        description="Default behavior assumes human-assisted publishing. If an official direct listing API exists for a supported surface, keep it behind a separate integration mode and preserve the same audit trail."
        title="Workflow policy"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Official direct path
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
              Use only where platform support is documented. Keep rate limits,
              permissions, and scope validation inside integration adapters.
            </p>
          </div>
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Human-assisted fallback
            </p>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
              Generate a draft, route it to the assigned employee, require review,
              and nudge completion with reminders instead of unsafe automation.
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        action={
          <Badge tone={connectedFacebookCount > 0 ? "forest" : "tan"}>
            {connectedFacebookCount > 0 ? "Ready for assignments" : "Waiting on live work"}
          </Badge>
        }
        title="Queued work"
      >
        <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--card-soft)] p-6">
          <p className="font-semibold text-[var(--foreground)]">No queue items yet</p>
          <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
            Queue records will appear here after inventory syncs create eligible
            vehicles, the rotation engine assigns ownership, and draft or review
            work is scheduled. Nothing is pre-seeded anymore.
          </p>
        </div>
      </Panel>

      <Panel
        action={<Badge tone="navy">{JOB_NAME_LIST.length} names</Badge>}
        description="Suggested BullMQ job names so operators and engineers can reason about queue intent quickly."
        title="Job catalog"
      >
        <div className="flex flex-wrap gap-2">
          {JOB_NAME_LIST.map((jobName) => (
            <code
              className="rounded-full border border-[var(--border)] bg-[var(--card-soft)] px-3 py-2 text-xs text-[var(--foreground)]"
              key={jobName}
            >
              {jobName}
            </code>
          ))}
        </div>
      </Panel>
    </div>
  );
}
