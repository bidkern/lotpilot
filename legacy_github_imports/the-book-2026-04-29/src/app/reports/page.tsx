"use client";

import { Activity, Building2, Facebook, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SetupRequired } from "@/components/setup/setup-required";
import { StatCard } from "@/components/ui/stat-card";
import { getWorkspaceSummary } from "@/lib/workspace-derived";
import { useWorkspace } from "@/lib/workspace-store";

export default function ReportsPage() {
  const workspace = useWorkspace();
  const summary = getWorkspaceSummary(workspace);

  if (!workspace.parentAccount) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Dealership reporting should stay operational, not vanity-driven. Reports stay empty until you set up the workspace with your own records."
          eyebrow="Reports"
          title="Sales workflow reporting"
        />
        <SetupRequired
          description="Create the parent account first so reporting can attach to a real tenant baseline."
          title="Reporting setup is not ready yet"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Dealership reporting should stay operational, not vanity-driven. The first version reflects your setup progress and keeps live workflow charts empty until real data arrives."
        eyebrow="Reports"
        title="Sales workflow reporting"
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <StatCard
          change={`${summary.completedSteps} of ${summary.checklist.length} setup steps complete`}
          icon={<Activity size={18} />}
          title="Workspace readiness"
          tone="forest"
          value={`${summary.completionPercent}%`}
        />
        <StatCard
          change="Tenant structure under the parent account"
          icon={<Building2 size={18} />}
          title="Dealerships"
          tone="navy"
          value={summary.dealershipCount.toString()}
        />
        <StatCard
          change="Child accounts available for roles and routing"
          icon={<Users size={18} />}
          title="Child accounts"
          tone="forest"
          value={summary.childCount.toString()}
        />
        <StatCard
          change="Connected records ready for messaging or assisted flows"
          icon={<Facebook size={18} />}
          title="Facebook attached"
          tone="tan"
          value={summary.connectedFacebookCount.toString()}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          action={<Badge tone="forest">First reports</Badge>}
          description="These are the first reports worth building as real data arrives."
          title="Operational report backlog"
        >
          <div className="space-y-3">
            {[
              "Listings posted by employee",
              "Inventory not yet listed",
              "Time to listing",
              "Response volume",
              "Follow-up lag",
              "Sold unit attribution",
            ].map((item) => (
              <div
                className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                key={item}
              >
                <p className="font-semibold text-[var(--foreground)]">{item}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          action={<Badge tone="navy">Zeroed until live</Badge>}
          description="No charts are faked anymore. Real reporting starts after inventory, assignments, and conversations exist."
          title="Live metrics state"
        >
          <div className="rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--card-soft)] p-6">
            <p className="font-semibold text-[var(--foreground)]">No reporting rows yet</p>
            <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
              Connect a dealership inventory source, assign vehicles, and start
              collecting conversations. The charts stay honest until that data
              exists.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
