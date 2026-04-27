import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type AuditInput = {
  action: string;
  actorId?: string | null;
  entityId: string;
  entityType: string;
  metadata?: Prisma.InputJsonValue;
  summary: string;
  tenantId?: string | null;
};

export async function createAuditLog(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      action: input.action,
      actorId: input.actorId ?? undefined,
      entityId: input.entityId,
      entityType: input.entityType,
      metadata: input.metadata,
      summary: input.summary,
      tenantId: input.tenantId ?? undefined,
    },
  });
}
