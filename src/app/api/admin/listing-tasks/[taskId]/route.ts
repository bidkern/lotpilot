import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "@/lib/request-auth";
import { updateListingTaskStatus } from "@/lib/services/listing-assignment-service";

const payloadSchema = z.object({
  action: z.enum(["dismiss", "markComplete", "start"]),
  externalListingUrl: z.string().trim().url().optional(),
  listingReference: z.string().trim().max(160).optional(),
});

type RouteParams = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  const authResult = await requireApiRole([UserRole.AGENT]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const payload = payloadSchema.parse(await request.json());
    const resolvedParams = await params;
    const result = await updateListingTaskStatus({
      action: payload.action,
      actorRole: authResult.user!.role,
      actorUserId: authResult.user!.id,
      externalListingUrl: payload.externalListingUrl,
      listingReference: payload.listingReference,
      taskId: resolvedParams.taskId,
      tenantId: authResult.user!.tenantId!,
    });

    return NextResponse.json({
      assignmentId: result.assignment.id,
      assignmentStatus: result.assignment.status,
      taskId: result.task.id,
      taskStatus: result.task.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update listing task.",
      },
      { status: 400 },
    );
  }
}
