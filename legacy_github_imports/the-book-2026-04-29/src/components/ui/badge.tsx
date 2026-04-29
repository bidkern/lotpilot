import type { ReactNode } from "react";

import { cx } from "@/lib/format";

const toneClasses = {
  forest:
    "border-[rgba(38,93,120,0.18)] bg-[rgba(38,93,120,0.08)] text-[var(--accent)]",
  navy:
    "border-[rgba(96,120,196,0.2)] bg-[rgba(96,120,196,0.1)] text-[var(--navy-strong)]",
  tan: "border-[rgba(184,132,82,0.22)] bg-[rgba(184,132,82,0.12)] text-[var(--tan-strong)]",
  danger:
    "border-[rgba(172,84,84,0.22)] bg-[rgba(172,84,84,0.1)] text-[#8f4646]",
  slate:
    "border-[rgba(80,91,111,0.12)] bg-[rgba(80,91,111,0.06)] text-[var(--muted-foreground)]",
} as const;

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: keyof typeof toneClasses;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
