import { NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { addSalesDealNoteForTenant } from "@/lib/sales-floor-persistence";
import { salesDealNoteSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ tenantId: string; dealId: string }>;
  },
) {
  const params = await context.params;
  const parsedParams = await parseTenantParams(
    Promise.resolve({ tenantId: params.tenantId }),
  );

  if (!parsedParams.success || !params.dealId?.trim()) {
    return jsonBadRequest("Invalid deal route.", parsedParams.error?.flatten());
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const parsedBody = salesDealNoteSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonBadRequest("Invalid deal note.", parsedBody.error.flatten());
  }

  try {
    const salesFloor = await addSalesDealNoteForTenant(
      parsedParams.data.tenantId,
      params.dealId,
      parsedBody.data,
    );

    return NextResponse.json({
      ok: true,
      tenantId: parsedParams.data.tenantId,
      salesFloor,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to append the note.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: message === "Deal record not found." ? 404 : 400,
      },
    );
  }
}
