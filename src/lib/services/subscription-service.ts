import { SubscriptionStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const enabledStatuses = new Set<SubscriptionStatus>([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIAL,
]);

export async function getTenantSubscriptionSummary(tenantId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      tenantId,
    },
    orderBy: [
      {
        currentPeriodEndsAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  return subscription
    ? {
        currentPeriodEndsAt: subscription.currentPeriodEndsAt?.toISOString() ?? null,
        planKey: subscription.planKey,
        status: subscription.status,
        trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      }
    : null;
}

export async function assertTenantMessagingAccess(tenantId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      tenantId,
    },
    orderBy: [
      {
        currentPeriodEndsAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  if (!subscription || !enabledStatuses.has(subscription.status)) {
    throw new Error("An active subscription or trial is required before connecting Meta messaging.");
  }

  return subscription;
}
