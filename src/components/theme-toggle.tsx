"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { useState } from "react";

type ThemeMode = "dark" | "light";

const STORAGE_KEY = "lotpilot-theme";

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
}

function detectInitialTheme(): ThemeMode {
  if (typeof document === "undefined") {
    return "light";
  }

  const datasetTheme = document.documentElement.dataset.theme;
  if (datasetTheme === "dark" || datasetTheme === "light") {
    return datasetTheme;
  }

  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(() => detectInitialTheme());

  function toggleTheme() {
    const nextTheme: ThemeMode = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
  }

  return (
    <button
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      className="fixed right-4 top-4 z-[60] inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-[0_16px_40px_rgba(12,24,20,0.14)] backdrop-blur"
      onClick={toggleTheme}
      type="button"
    >
      {theme === "light" ? <MoonStar className="h-4 w-4" /> : <SunMedium className="h-4 w-4" />}
      {theme === "light" ? "Dark mode" : "Light mode"}
    </button>
  );
}
