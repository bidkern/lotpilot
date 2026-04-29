"use client";

import Link from "next/link";
import { ArrowRight, CircleCheckBig } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getWorkspaceSummary } from "@/lib/workspace-derived";
import { useWorkspace } from "@/lib/workspace-store";

export function SetupRequired({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const workspace = useWorkspace();
  const summary = getWorkspaceSummary(workspace);
  const missingSteps = summary.checklist.filter((step) => !step.complete);

  return (
    <Panel
      action={<Badge tone="tan">Setup required</Badge>}
      description={description}
      title={title}
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
        <div className="space-y-3">
          <p className="text-sm leading-7 text-[var(--muted-foreground)]">
            This area is ready, but it stays intentionally empty until you set up
            the workspace with your own parent account, dealership, child
            accounts, and Facebook attachments.
          </p>
          <div className="space-y-2">
            {missingSteps.map((step) => (
              <div
                className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card-soft)] px-4 py-3"
                key={step.id}
              >
                <CircleCheckBig className="text-[var(--accent)]" size={16} />
                <span className="text-sm text-[var(--foreground)]">{step.label}</span>
              </div>
            ))}
          </div>
          <Link
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-[var(--tan)] transition hover:opacity-90"
            href="/"
          >
            Open setup workspace
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
            Completion
          </p>
          <p className="mt-3 font-[family:var(--font-display)] text-5xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
            {summary.completionPercent}%
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {summary.completedSteps} of {summary.checklist.length} setup steps finished.
          </p>
        </div>
      </div>
    </Panel>
  );
}
