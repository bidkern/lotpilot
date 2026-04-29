"use client";

import { ShieldCheck, SlidersHorizontal, Webhook, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SetupRequired } from "@/components/setup/setup-required";
import { useWorkspace } from "@/lib/workspace-store";

const settingsCards = [
  {
    title: "Inventory source",
    description:
      "Track polling cadence, webhook deliveries, normalization errors, and stale-source alerts.",
    icon: Wrench,
  },
  {
    title: "Posting rules",
    description:
      "Configure rotation order, cooldown windows, daily caps, and admin override permissions.",
    icon: SlidersHorizontal,
  },
  {
    title: "Security and secrets",
    description:
      "Keep OAuth tokens encrypted at rest and restrict secret rotation to admins only.",
    icon: ShieldCheck,
  },
  {
    title: "Webhook health",
    description:
      "Validate signatures, persist raw payloads, and capture retry-safe processing outcomes.",
    icon: Webhook,
  },
] as const;

export default function SettingsPage() {
  const workspace = useWorkspace();

  if (!workspace.parentAccount) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Settings cluster around integrations, workflow rules, and operator safety. Create the parent account first so there is a real tenant baseline to configure."
          eyebrow="Settings"
          title="Operational controls"
        />
        <SetupRequired
          description="Create the parent account before using the settings workspace."
          title="Settings setup is not ready yet"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Settings cluster around integrations, workflow rules, and operator safety. The baseline values below come from your local setup workspace instead of seeded company data."
        eyebrow="Settings"
        title="Operational controls"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {settingsCards.map((card) => {
          const Icon = card.icon;

          return (
            <Panel key={card.title}>
              <div className="flex items-start gap-4">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card-soft)] text-[var(--accent)]">
                  <Icon size={18} />
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">{card.title}</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
                    {card.description}
                  </p>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel
        action={<Badge tone="navy">Starter mode</Badge>}
        description="Tenant-level values that every module depends on."
        title="Tenant baseline"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <p className="text-sm text-[var(--muted-foreground)]">Product name</p>
            <p className="mt-2 font-[family:var(--font-display)] text-2xl font-semibold tracking-[-0.04em]">
              The Book
            </p>
          </div>
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <p className="text-sm text-[var(--muted-foreground)]">Parent account</p>
            <p className="mt-2 font-semibold text-[var(--foreground)]">
              {workspace.parentAccount.name}
            </p>
          </div>
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
            <p className="text-sm text-[var(--muted-foreground)]">Connected dealerships</p>
            <p className="mt-2 font-semibold text-[var(--foreground)]">
              {workspace.dealerships.length}
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
