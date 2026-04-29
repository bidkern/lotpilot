"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (!mounted) {
    return (
      <button
        aria-label="Toggle theme"
        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)]"
        type="button"
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      aria-label="Toggle theme"
      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      type="button"
    >
      {isDark ? <SunMedium size={18} /> : <MoonStar size={18} />}
    </button>
  );
}
