import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseZap, Layers3, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { BrandLockup } from "@/components/brand-lockup";
import { LoginForm } from "@/components/login-form";
import { getTenantWorkspaceState } from "@/lib/services/tenant-service";

export const metadata: Metadata = {
  title: "Login | LotPilot",
};

type LoginPageProps = {
  searchParams?: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
};

const errorMessageMap: Record<string, string> = {
  CredentialsSignin: "The email or password did not match an active account.",
  unauthorized: "Your account does not have permission to open this workspace.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, resolvedSearchParams] = await Promise.all([auth(), searchParams]);

  if (session?.user) {
    const callbackUrl = resolvedSearchParams?.callbackUrl;
    if (callbackUrl?.startsWith("/")) {
      redirect(callbackUrl);
    }

    if (!session.user.tenantId) {
      redirect("/register");
    }

    const workspace = await getTenantWorkspaceState(session.user.tenantId);
    redirect(workspace.requiresOnboarding ? "/onboarding" : "/admin");
  }

  const errorCode = resolvedSearchParams?.error;
  const errorMessage = errorCode ? errorMessageMap[errorCode] ?? "Unable to sign in." : null;
  const callbackUrl = resolvedSearchParams?.callbackUrl;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid w-full gap-8 lg:grid-cols-[minmax(0,1.2fr),440px]">
        <section className="relative overflow-hidden rounded-[36px] border border-[rgba(228,209,170,0.18)] bg-[linear-gradient(135deg,rgba(8,22,25,0.98),rgba(18,53,47,0.95),rgba(82,125,92,0.9))] p-8 text-white shadow-[0_30px_90px_rgba(10,20,21,0.32)] sm:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(228,209,170,0.18),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]" />
          <div className="relative">
            <BrandLockup caption="All-in-one dealer operations software" />
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Inventory, listing ops, and customer messaging in one dealer workspace.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-white/78 sm:text-lg">
              Dealers get a simple paste-a-URL workflow, then manage synced inventory, employee
              listing queues, and Facebook-connected customer conversations from the same platform.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <article className="rounded-[24px] border border-white/15 bg-white/10 p-5 backdrop-blur">
                <Layers3 className="h-6 w-6 text-white/85" />
                <h2 className="mt-4 text-lg font-semibold">Layered detection</h2>
                <p className="mt-2 text-sm leading-6 text-white/72">
                  Feed discovery, JSON-LD, platform templates, generic crawling, then review fallback.
                </p>
              </article>
              <article className="rounded-[24px] border border-white/15 bg-white/10 p-5 backdrop-blur">
                <DatabaseZap className="h-6 w-6 text-white/85" />
                <h2 className="mt-4 text-lg font-semibold">Tenant isolation</h2>
                <p className="mt-2 text-sm leading-6 text-white/72">
                  One Postgres database with tenant-safe auth, queries, audit logs, and job records.
                </p>
              </article>
              <article className="rounded-[24px] border border-white/15 bg-white/10 p-5 backdrop-blur">
                <ShieldCheck className="h-6 w-6 text-white/85" />
                <h2 className="mt-4 text-lg font-semibold">Honest automation</h2>
                <p className="mt-2 text-sm leading-6 text-white/72">
                  Supported sites activate quickly. Low-confidence sites stay reviewable instead of pretending.
                </p>
              </article>
            </div>

            <p className="mt-8 text-sm text-white/76">
              New dealer?{" "}
              <Link className="font-semibold text-[var(--brand-cream)]" href="/register">
                Create a workspace
              </Link>
            </p>
          </div>
        </section>

        <LoginForm callbackUrl={callbackUrl} errorMessage={errorMessage} />
      </div>
    </main>
  );
}
