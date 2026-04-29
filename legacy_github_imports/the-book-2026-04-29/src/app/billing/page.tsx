"use client";

import { CreditCard, Receipt, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SetupRequired } from "@/components/setup/setup-required";
import { useWorkspace } from "@/lib/workspace-store";

export default function BillingPage() {
  const workspace = useWorkspace();

  if (!workspace.parentAccount) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Billing belongs to the parent account, not an individual employee. Create that parent account first so billing has a real owner."
          eyebrow="Billing"
          title="Subscription and seats"
        />
        <SetupRequired
          description="Create the parent account before using the billing workspace."
          title="Billing setup is not ready yet"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Billing belongs to the parent account, not an individual dealership employee. The starter keeps this area grounded in your own setup instead of seeded plans and seat counts."
        eyebrow="Billing"
        title="Subscription and seats"
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <div className="flex items-center gap-3">
            <CreditCard size={18} className="text-[var(--accent)]" />
            <p className="font-semibold text-[var(--foreground)]">Plan</p>
          </div>
          <p className="mt-4 font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em]">
            Starter scaffold
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Add Stripe or manual billing once auth and persistence are wired.
          </p>
        </Panel>

        <Panel>
          <div className="flex items-center gap-3">
            <Users size={18} className="text-[var(--accent)]" />
            <p className="font-semibold text-[var(--foreground)]">Seats</p>
          </div>
          <p className="mt-4 font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em]">
            {workspace.childAccounts.length}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Child accounts currently created under the parent account.
          </p>
        </Panel>

        <Panel>
          <div className="flex items-center gap-3">
            <Receipt size={18} className="text-[var(--accent)]" />
            <p className="font-semibold text-[var(--foreground)]">Billing owner</p>
          </div>
          <div className="mt-4">
            <Badge tone="navy">Setup mode</Badge>
          </div>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {workspace.parentAccount.billingEmail}
          </p>
        </Panel>
      </div>
    </div>
  );
}
