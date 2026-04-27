import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "@/lib/request-auth";
import { queueSourceSync } from "@/lib/services/inventory-service";

const payloadSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  const authResult = await requireApiRole([UserRole.MANAGER]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const payload = payloadSchema.parse(await request.json());
    const tenantId = authResult.user!.tenantId!;

    const jobs = await Promise.all(
      payload.sourceIds.map((sourceId) =>
        queueSourceSync({
          createdById: authResult.user!.id,
          sourceId,
          tenantId,
        }),
      ),
    );

    return NextResponse.json({
      queued: jobs.length,
      syncRunIds: jobs.map((job) => job.id),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to queue sync jobs.",
      },
      { status: 400 },
    );
  }
}
