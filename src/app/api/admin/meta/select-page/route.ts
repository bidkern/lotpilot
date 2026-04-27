import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "@/lib/request-auth";
import {
  activateMessagingPage,
  getSafeMessagingConnectionSummary,
} from "@/lib/services/meta-service";

const payloadSchema = z.object({
  metaAuthAccountId: z.string().min(1),
  pageId: z.string().min(1),
});

export async function POST(request: Request) {
  const authResult = await requireApiRole([UserRole.AGENT]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const payload = payloadSchema.parse(await request.json());
    const connection = await activateMessagingPage({
      metaAuthAccountId: payload.metaAuthAccountId,
      pageId: payload.pageId,
      tenantId: authResult.user!.tenantId!,
      userId: authResult.user!.id,
    });

    return NextResponse.json({
      connection: getSafeMessagingConnectionSummary(connection),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to activate that Facebook Page.",
      },
      { status: 400 },
    );
  }
}
