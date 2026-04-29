"use client";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SetupRequired } from "@/components/setup/setup-required";
import { useWorkspace } from "@/lib/workspace-store";

export default function InventoryPage() {
  const workspace = useWorkspace();
  const connectedFacebookCount = workspace.facebookConnections.filter(
    (connection) => connection.status === "CONNECTED",
  ).length;
  const inventorySourceCount = workspace.inventorySources.length;

  if (!workspace.parentAccount || workspace.dealerships.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Inventory stays empty until you configure your own workspace and connect a real source. This starter avoids guessed dealership vehicles entirely."
          eyebrow="Inventory"
          title="Inventory control"
        />
        <SetupRequired
          description="Create the parent account and at least one dealership before inventory ingestion is enabled."
          title="Inventory setup is not ready yet"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description="Normalized inventory will stay source-of-truth clean once a real source is connected. Until then, this page stays empty on purpose and shows the operational scaffolding only."
        eyebrow="Inventory"
        title="Inventory control"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Dealerships ready">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
            {workspace.dealerships.length}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Dealership records configured for source onboarding.
          </p>
        </Panel>
        <Panel title="Connected Facebooks">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
            {connectedFacebookCount}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Child accounts ready for assisted listing ownership.
          </p>
        </Panel>
        <Panel title="Inventory sources">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
            {inventorySourceCount}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {inventorySourceCount === 0
              ? "No API, feed, webhook, or manual import connected yet."
              : "Source definitions saved and ready for ingestion work."}
          </p>
        </Panel>
      </div>

      <Panel
        action={
          <Badge tone={inventorySourceCount > 0 ? "forest" : "navy"}>
            {inventorySourceCount > 0 ? "Sources configured" : "MVP filters ready"}
          </Badge>
        }
        description="These are the first filters the real inventory table will support as soon as a source is connected."
        title="Inventory table plan"
      >
        <div className="flex flex-wrap gap-2">
          {[
            "Price",
            "Make",
            "Model",
            "Time on lot",
            "Miles",
            "Listed on Facebook / not listed",
            "Employee account",
          ].map((label) => (
            <Badge key={label} tone="slate">
              {label}
            </Badge>
          ))}
        </div>
        <div className="mt-5 rounded-[24px] border border-dashed border-[var(--border)] bg-[var(--card-soft)] p-6">
          <p className="font-semibold text-[var(--foreground)]">
            {inventorySourceCount > 0 ? "Inventory source definitions ready" : "No inventory loaded yet"}
          </p>
          <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
            {inventorySourceCount > 0
              ? "The next step is wiring sync jobs and normalization against these persisted source records. Vehicles will stay empty until a real sync or import runs."
              : "The next step is connecting an inventory source per dealership. The product will normalize incoming vehicles, track change events, update listing eligibility, and preserve an audit trail without seeding fake units into your workspace."}
          </p>
          {inventorySourceCount > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {workspace.inventorySources.map((source) => (
                <Badge key={source.id} tone="slate">
                  {source.label} · {source.type} · {source.status}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
