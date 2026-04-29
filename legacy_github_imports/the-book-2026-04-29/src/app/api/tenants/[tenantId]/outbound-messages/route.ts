import { NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { getOutboundMessageSnapshot } from "@/lib/outbound-message-service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  const messages = await getOutboundMessageSnapshot(parsedParams.data.tenantId);

  return NextResponse.json({
    ok: true,
    tenantId: parsedParams.data.tenantId,
    messages,
  });
}
