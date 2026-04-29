import { NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { queueItems } from "@/lib/demo-data";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  return NextResponse.json({
    ok: true,
    mode: "demo",
    tenantId: parsedParams.data.tenantId,
    queue: queueItems,
    setupRequired: false,
  });
}
