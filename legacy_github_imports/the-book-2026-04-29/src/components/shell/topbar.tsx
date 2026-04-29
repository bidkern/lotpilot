"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Building2, Users } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { useSalesFloor } from "@/lib/sales-floor-store";
import { getWorkspaceSummary } from "@/lib/workspace-derived";
import { useWorkspace } from "@/lib/workspace-store";

export function Topbar() {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const summary = getWorkspaceSummary(workspace);
  const salesFloor = useSalesFloor();
  const snapshot = salesFloor.snapshot;

  if (pathname === "/") {
    return (
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[rgba(246,241,234,0.72)] backdrop-blur-xl dark:bg-[rgba(21,26,34,0.72)]">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <Badge tone="forest">Live demo</Badge>
            <Badge tone="danger">{snapshot.financeHandoffCount} manager handoffs</Badge>
            <p className="text-sm text-[var(--muted-foreground)]">
              Work one deal at a time, keep the conversation clear, and use the actions below when automation needs help.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              href="/setup"
            >
              <Building2 size={16} />
              Workspace setup
            </Link>
            <Link
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:opacity-90"
              href="/test-lab"
            >
              <Users size={16} />
              Open demo lab
              <ArrowUpRight size={16} />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[rgba(246,241,234,0.72)] backdrop-blur-xl dark:bg-[rgba(21,26,34,0.72)]">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-3">
          <Badge tone={summary.parentConfigured ? "forest" : "tan"}>
            {summary.parentConfigured ? "Setup active" : "Setup needed"}
          </Badge>
          <Badge tone="navy">{summary.completionPercent}% ready</Badge>
          <p className="text-sm text-[var(--muted-foreground)]">
            {workspace.parentAccount
              ? `${workspace.parentAccount.name} with ${summary.dealershipCount} dealership${
                  summary.dealershipCount === 1 ? "" : "s"
                }`
              : "No parent account configured yet"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            href="/setup"
          >
            <Building2 size={16} />
            Workspace setup
          </Link>
          <Link
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:opacity-90"
            href="/"
          >
            <Users size={16} />
            Open sales floor
            <ArrowUpRight size={16} />
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
