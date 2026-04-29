import type { Metadata } from "next";
import { UserRole } from "@prisma/client";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { BrandLockup } from "@/components/brand-lockup";
import { ConversationInbox } from "@/components/conversation-inbox";
import { EmployeeListingBucket } from "@/components/employee-listing-bucket";
import { prisma } from "@/lib/prisma";
import { getConversationInboxData } from "@/lib/services/conversation-service";
import { getEmployeeListingBucketData } from "@/lib/services/listing-assignment-service";
import { buildUserMessagesPath } from "@/lib/workspace-routes";

export const metadata: Metadata = {
  title: "Messages | LotPilot",
};

type MessagesPageProps = {
  params: Promise<{
    tenantSlug: string;
    userSlug: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function UserMessagesPage({ params }: MessagesPageProps) {
  const resolvedParams = await params;
  const requestedPath = `/${resolvedParams.tenantSlug}/${resolvedParams.userSlug}/messages`;
  const session = await auth();

  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(requestedPath)}`);
  }

  if (!session.user.tenantId) {
    redirect("/register");
  }

  if (
    ![
      UserRole.AGENT,
      UserRole.MANAGER,
      UserRole.ADMIN,
      UserRole.OWNER,
    ].includes(session.user.role)
  ) {
    redirect("/login?error=unauthorized");
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: {
      id: session.user.tenantId,
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  const canonicalPath = buildUserMessagesPath({
    tenantName: tenant.name,
    userEmail: session.user.email,
    userId: session.user.id,
    userName: session.user.name,
  });

  if (requestedPath.toLowerCase() !== canonicalPath.toLowerCase()) {
    redirect(canonicalPath);
  }

  const [conversations, listingBucket] = await Promise.all([
    getConversationInboxData({
      tenantId: tenant.id,
      viewerRole: session.user.role,
      viewerUserId: session.user.id,
    }),
    getEmployeeListingBucketData({
      tenantId: tenant.id,
      userId: session.user.id,
    }),
  ]);

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BrandLockup caption="Private customer message workspace" />
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-[0_16px_36px_rgba(12,24,20,0.08)]">
              <ShieldCheck className="h-4 w-4" />
              Tenant- and user-scoped inbox
            </div>
            <Link
              className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-[0_16px_36px_rgba(12,24,20,0.08)] transition hover:border-[var(--foreground)]"
              href="/admin"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to workspace
            </Link>
          </div>
        </div>

        <section className="rounded-[34px] border border-[var(--line)] bg-[var(--panel-strong)] px-6 py-7 shadow-[0_24px_80px_rgba(14,26,22,0.1)] sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
            Secure message route
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
            {tenant.name} message workspace
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-[var(--muted)]">
            This inbox route only resolves for the signed-in dealership account and the current
            team member under that tenant. Typing another dealership or user path will redirect to
            the correct authorized page instead of exposing someone else&apos;s data.
          </p>
        </section>

        <EmployeeListingBucket bucket={listingBucket} />

        <ConversationInbox
          conversations={conversations}
          currentUser={{
            email: session.user.email,
            id: session.user.id,
            name: session.user.name,
            role: session.user.role,
          }}
          tenantName={tenant.name}
        />
      </div>
    </main>
  );
}
