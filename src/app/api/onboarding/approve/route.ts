import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "@/lib/request-auth";
import { approveInventorySource } from "@/lib/services/onboarding-service";

const payloadSchema = z.object({
  detectionRunId: z.string().min(1),
});

export async function POST(request: Request) {
  const authResult = await requireApiRole([UserRole.MANAGER]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const payload = payloadSchema.parse(await request.json());
    const result = await approveInventorySource({
      createdById: authResult.user!.id,
      detectionRunId: payload.detectionRunId,
      tenantId: authResult.user!.tenantId!,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to approve source onboarding.",
      },
      { status: 400 },
    );
  }
}
