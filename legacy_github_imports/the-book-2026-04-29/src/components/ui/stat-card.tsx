import type { ReactNode } from "react";

import { cx } from "@/lib/format";

const toneClasses = {
  forest: "border-[rgba(38,93,120,0.18)] bg-[rgba(38,93,120,0.08)] text-[var(--accent)]",
  navy: "border-[rgba(96,120,196,0.18)] bg-[rgba(96,120,196,0.1)] text-[var(--navy-strong)]",
  tan: "border-[rgba(184,132,82,0.2)] bg-[rgba(184,132,82,0.12)] text-[var(--tan-strong)]",
  danger: "border-[rgba(172,84,84,0.18)] bg-[rgba(172,84,84,0.1)] text-[#8f4646]",
} as const;

export function StatCard({
  title,
  value,
  change,
  icon,
  tone,
}: {
  title: string;
  value: string;
  change: string;
  icon: ReactNode;
  tone: keyof typeof toneClasses;
}) {
  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-[linear-gradient(180deg,var(--card),var(--card-soft))] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-4">
        <div
          className={cx(
            "inline-flex h-11 w-11 items-center justify-center rounded-2xl border",
            toneClasses[tone],
          )}
        >
          {icon}
        </div>
        <span className="max-w-[12rem] text-right text-sm leading-6 text-[var(--muted-foreground)]">
          {change}
        </span>
      </div>
      <div className="mt-6 space-y-1">
        <p className="text-sm font-medium tracking-[0.02em] text-[var(--muted-foreground)]">
          {title}
        </p>
        <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
          {value}
        </p>
      </div>
    </div>
  );
}
