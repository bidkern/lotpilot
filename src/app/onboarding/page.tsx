import type { Metadata } from "next";
import { UserRole } from "@prisma/client";

import { auth } from "@/auth";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Onboarding | The Book",
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = requireRole(await auth(), [UserRole.MANAGER]);
  const tenantId = session.user.tenantId!;

  const sources = await prisma.inventorySource.findMany({
    where: {
      tenantId,
    },
    include: {
      detectionRuns: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return (
    <OnboardingWizard
      existingSources={sources.map((source) => ({
        id: source.id,
        lastDetectionStatus: source.detectionRuns[0]?.status ?? null,
        lastDetectionSummary: source.detectionRuns[0]?.summary ?? null,
        name: source.name,
        requiresReview: source.requiresReview,
        status: source.status,
        websiteUrl: source.websiteUrl,
      }))}
      tenantName={session.user.tenantName ?? "Dealer Workspace"}
    />
  );
}
