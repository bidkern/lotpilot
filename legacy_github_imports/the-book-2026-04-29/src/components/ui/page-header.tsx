import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-4xl space-y-3">
        {eyebrow ? (
          <p className="text-sm font-semibold tracking-[0.04em] text-[var(--accent)]">
            {eyebrow}
          </p>
        ) : null}
        <div className="space-y-2">
          <h1 className="max-w-4xl font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-3xl text-[15px] leading-7 text-[var(--muted-foreground)]">
            {description}
          </p>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
