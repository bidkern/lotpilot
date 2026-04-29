"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CarFront,
  CreditCard,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cx } from "@/lib/format";
import { useSalesFloor } from "@/lib/sales-floor-store";

const navItems = [
  { href: "/", label: "Sales Floor", icon: LayoutDashboard },
  { href: "/test-lab", label: "Test Lab", icon: FlaskConical },
  { href: "/setup", label: "Setup", icon: Building2 },
  { href: "/inventory", label: "Inventory", icon: CarFront },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/queue", label: "Queue", icon: ListChecks },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  const salesFloor = useSalesFloor();
  const snapshot = salesFloor.snapshot;

  return (
    <aside className="border-b border-[var(--border)] bg-[linear-gradient(180deg,var(--sidebar),color-mix(in_srgb,var(--sidebar)_86%,#ffffff))] md:sticky md:top-0 md:h-screen md:w-[300px] md:border-b-0 md:border-r">
      <div className="flex h-full flex-col">
        <div className="border-b border-[var(--border)] px-5 py-5 md:px-6">
          <Link className="inline-flex items-center gap-3" href="/">
            <div className="grid h-12 w-12 place-items-center rounded-[18px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(236,240,248,0.9))] text-[var(--accent)] shadow-[0_16px_32px_rgba(50,44,36,0.08)]">
              <span className="font-[family:var(--font-display)] text-xl font-semibold tracking-[-0.05em]">
                A
              </span>
            </div>
            <div>
              <p className="font-[family:var(--font-display)] text-2xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
                Autonomous Car Salesman
              </p>
              <p className="text-sm text-[var(--muted-foreground)]">
                Sales workspace for the demo
              </p>
            </div>
          </Link>
        </div>

        <nav className="flex gap-2 overflow-x-auto px-4 py-4 md:flex-1 md:flex-col md:overflow-visible md:px-5">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                className={cx(
                  "inline-flex min-w-max items-center gap-3 rounded-2xl border border-transparent px-4 py-3 text-sm font-medium transition",
                  isActive
                    ? "border-[rgba(38,93,120,0.18)] bg-[rgba(255,255,255,0.72)] text-[var(--accent)] shadow-[0_10px_24px_rgba(50,44,36,0.05)]"
                    : "text-[var(--muted-foreground)] hover:bg-[rgba(255,255,255,0.56)] hover:text-[var(--foreground)]",
                )}
                href={item.href}
                key={item.href}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden border-t border-[var(--border)] px-5 py-5 md:block">
          <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                Live pipeline
              </p>
              <Badge tone="forest">
                Demo live
              </Badge>
            </div>
            <div className="mt-4 space-y-3">
              {[
                {
                  label: "Active buyers",
                  value: snapshot.qualifiedBuyerCount.toString(),
                  tone: "forest" as const,
                },
                {
                  label: "Scheduled visits",
                  value: snapshot.appointmentReadyCount.toString(),
                  tone:
                    snapshot.appointmentReadyCount > 0
                      ? ("forest" as const)
                      : ("tan" as const),
                },
                {
                  label: "Manager handoffs",
                  value: snapshot.financeHandoffCount.toString(),
                  tone:
                    snapshot.financeHandoffCount > 0
                      ? ("danger" as const)
                      : ("navy" as const),
                },
              ].map((step) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-2xl bg-[rgba(255,255,255,0.56)] px-3 py-2.5"
                  key={step.label}
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {step.label}
                    </p>
                  </div>
                  <Badge tone={step.tone}>
                    {step.value}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
