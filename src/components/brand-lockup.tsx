type BrandLockupProps = {
  align?: "left" | "center";
  caption?: string;
  className?: string;
};

export function BrandLockup({
  align = "left",
  caption = "Dealer operations intelligence",
  className = "",
}: BrandLockupProps) {
  const alignmentClass = align === "center" ? "items-center text-center" : "items-start text-left";

  return (
    <div className={`flex flex-col gap-3 ${alignmentClass} ${className}`.trim()}>
      <div className="inline-flex items-center gap-3 rounded-[1.4rem] border border-[rgba(231,212,165,0.44)] bg-[linear-gradient(180deg,rgba(11,23,37,0.94),rgba(11,23,37,0.88))] px-4 py-2.5 text-[var(--brand-cream)] shadow-[0_20px_48px_rgba(6,16,18,0.22)] backdrop-blur">
        <span className="flex h-11 w-11 items-center justify-center rounded-[1.05rem] border border-[rgba(231,212,165,0.58)] bg-[linear-gradient(180deg,rgba(93,138,97,0.96),rgba(75,117,79,0.94))] text-sm font-semibold uppercase tracking-[0.26em] text-[var(--brand-cream)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
          LP
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-[rgba(231,212,165,0.86)]">
            LotPilot
          </p>
          <p className="text-sm font-semibold tracking-[-0.02em] text-[var(--brand-fog)]">
            Dealer Operations OS
          </p>
        </div>
      </div>
      <p className="text-xs font-medium uppercase tracking-[0.28em] text-[var(--muted)]">
        {caption}
      </p>
    </div>
  );
}
