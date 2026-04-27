import type { Metadata } from "next";
import { UserRole } from "@prisma/client";
import { ChevronLeft, Link2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { BrandLockup } from "@/components/brand-lockup";
import { MetaConnectButton } from "@/components/meta-connect-button";
import { MessagingWorkspacePanel } from "@/components/messaging-workspace-panel";
import { requireRole } from "@/lib/authz";
import { getMessagingWorkspaceData } from "@/lib/services/conversation-service";
import { getTenantSubscriptionSummary } from "@/lib/services/subscription-service";
import { buildUserMessagesPath } from "@/lib/workspace-routes";

export const metadata: Metadata = {
  title: "Connect Facebook | The Book",
};

export const dynamic = "force-dynamic";

export default async function FacebookConnectionPage() {
  const session = requireRole(await auth(), [UserRole.AGENT]);
  const tenantId = session.user.tenantId;

  if (!tenantId) {
    redirect("/register");
  }

  const [messagingWorkspace, subscription] = await Promise.all([
    getMessagingWorkspaceData(tenantId, {
      role: session.user.role,
      userId: session.user.id,
    }),
    getTenantSubscriptionSummary(tenantId),
  ]);

  const tenantName = session.user.tenantName || "Your dealership workspace";
  const messagesHref = buildUserMessagesPath({
    tenantName,
    userEmail: session.user.email,
    userId: session.user.id,
    userName: session.user.name,
  });

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <BrandLockup caption="Meta account connection" />
          <Link
            className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-[0_16px_36px_rgba(12,24,20,0.08)] transition hover:border-[var(--foreground)]"
            href="/admin"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to workspace
          </Link>
        </div>

        <section className="overflow-hidden rounded-[36px] border border-[var(--line)] bg-[var(--panel-strong)] shadow-[0_24px_80px_rgba(14,26,22,0.12)]">
          <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="border-b border-[var(--line)] px-6 py-8 sm:px-8 lg:border-b-0 lg:border-r">
              <p className="font-mono text-xs uppercase tracking-[0.34em] text-[var(--muted)]">
                Connect Facebook
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
                Link a Meta account to {tenantName}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--muted)]">
                This connection page starts the official Facebook Login flow, then links the chosen
                Facebook account and its Pages back to this parent workspace. Once connected, Page
                conversations and publication destinations stay scoped to this dealership only.
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
                Any signed-in team member under this dealership account can start the login flow
                from this page. The Book still keeps the Meta secret exchange on the server so the
                connection stays secure.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <MetaConnectButton />
                <Link
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/76 px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                  href="/admin"
                >
                  Return to workspace
                </Link>
              </div>
            </div>

            <div className="grid gap-3 px-6 py-8 sm:px-8">
              <article className="rounded-[24px] border border-[var(--line)] bg-white/82 p-5">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[rgba(12,22,33,0.92)] text-[var(--brand-cream)]">
                    <Link2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                      Parent Workspace
                    </p>
                    <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                      {tenantName}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                  Every connected Facebook account and Page is attached to this tenant, not shared
                  across other dealerships.
                </p>
              </article>

              <article className="rounded-[24px] border border-[var(--line)] bg-white/82 p-5">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[rgba(46,107,83,0.16)] text-[var(--accent-strong)]">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                      Access Boundary
                    </p>
                    <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                      Official Page connection only
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                  The Book connects Facebook Pages through Meta OAuth. Personal-profile automation
                  is intentionally not enabled.
                </p>
              </article>

              <article className="rounded-[24px] border border-[var(--line)] bg-white/82 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  Subscription Status
                </p>
                <p className="mt-3 text-2xl font-semibold text-[var(--foreground)]">
                  {subscription?.status || "No subscription"}
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  Meta messaging stays enabled only for active trials or active paid plans tied to
                  this tenant.
                </p>
              </article>
            </div>
          </div>
        </section>

        <MessagingWorkspacePanel
          connectMode="popup"
          messaging={{
            ...messagingWorkspace,
            publicationDestinations: [],
            subscription,
          }}
          messagesHref={messagesHref}
          role={session.user.role}
        />
      </div>
    </main>
  );
}
