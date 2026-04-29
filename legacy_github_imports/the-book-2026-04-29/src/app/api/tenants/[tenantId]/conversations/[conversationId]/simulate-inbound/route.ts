import { NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { simulateCustomerMessageForTenant } from "@/lib/sales-floor-persistence";
import { simulatedCustomerMessageSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ tenantId: string; conversationId: string }>;
  },
) {
  const params = await context.params;
  const parsedParams = await parseTenantParams(
    Promise.resolve({ tenantId: params.tenantId }),
  );

  if (!parsedParams.success || !params.conversationId?.trim()) {
    return jsonBadRequest("Invalid conversation route.", parsedParams.error?.flatten());
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const parsedBody = simulatedCustomerMessageSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonBadRequest("Invalid simulated customer message.", parsedBody.error.flatten());
  }

  try {
    const salesFloor = await simulateCustomerMessageForTenant(
      parsedParams.data.tenantId,
      params.conversationId,
      parsedBody.data.body,
    );

    return NextResponse.json({
      ok: true,
      tenantId: parsedParams.data.tenantId,
      salesFloor,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to simulate customer input.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: message === "Conversation record not found." ? 404 : 400,
      },
    );
  }
}
