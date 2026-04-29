import type { ReactNode } from "react";

import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] md:flex">
      <Sidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
          <div className="mx-auto w-full max-w-[1520px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
