import type { Metadata } from "next";
import { Building2, Layers3, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { BrandLockup } from "@/components/brand-lockup";
import { RegisterForm } from "@/components/register-form";
import { getTenantWorkspaceState } from "@/lib/services/tenant-service";

export const metadata: Metadata = {
  title: "Create Workspace | LotPilot",
};

export default async function RegisterPage() {
  const session = await auth();

  if (session?.user?.tenantId) {
    const workspace = await getTenantWorkspaceState(session.user.tenantId);
    redirect(workspace.requiresOnboarding ? "/onboarding" : "/admin");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.1fr),460px]">
        <section className="rounded-[36px] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(247,250,245,0.98),rgba(231,238,231,0.95),rgba(215,226,216,0.95))] p-8 shadow-[0_30px_90px_rgba(15,22,26,0.12)] sm:p-10">
          <BrandLockup caption="Private all-in-one dealer workspaces" />
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-[var(--foreground)] sm:text-5xl">
            Create the first tenant and start onboarding dealership sites.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
            Each dealer gets one isolated workspace for source profiles, synced inventory, listing
            assignments, customer conversations, export history, and role-based access.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <article className="rounded-[24px] border border-[var(--line)] bg-white/80 p-5">
              <UserPlus className="h-6 w-6 text-[var(--accent-strong)]" />
              <h2 className="mt-4 text-lg font-semibold text-[var(--foreground)]">Owner account</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Creates the tenant, becomes the default owner, and can add the team later.
              </p>
            </article>
            <article className="rounded-[24px] border border-[var(--line)] bg-white/80 p-5">
              <Building2 className="h-6 w-6 text-[var(--accent-strong)]" />
              <h2 className="mt-4 text-lg font-semibold text-[var(--foreground)]">Dealer workspace</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Every inventory source, export job, and audit event is scoped to the tenant.
              </p>
            </article>
            <article className="rounded-[24px] border border-[var(--line)] bg-white/80 p-5">
              <Layers3 className="h-6 w-6 text-[var(--accent-strong)]" />
              <h2 className="mt-4 text-lg font-semibold text-[var(--foreground)]">Guided onboarding</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                The next step after signup is URL detection, preview, approval, and automated sync activation.
              </p>
            </article>
          </div>
        </section>

        <RegisterForm />
      </div>
    </main>
  );
}
