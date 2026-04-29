import type { ReactNode } from "react";

import { cx } from "@/lib/format";

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-[30px] border border-[var(--border)] bg-[linear-gradient(180deg,var(--card),var(--card-soft))] shadow-[var(--shadow-card)] backdrop-blur-md",
        className,
      )}
    >
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <div className="space-y-1">
            {title ? (
              <h2 className="font-[family:var(--font-display)] text-xl font-semibold tracking-[-0.03em] text-[var(--foreground)]">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}
