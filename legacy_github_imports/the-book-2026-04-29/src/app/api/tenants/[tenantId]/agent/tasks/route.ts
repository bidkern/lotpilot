import { NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { getAgentTaskSnapshot } from "@/lib/agent-task-persistence";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  const snapshot = await getAgentTaskSnapshot(parsedParams.data.tenantId);

  return NextResponse.json({
    ok: true,
    tenantId: parsedParams.data.tenantId,
    ...snapshot,
  });
}
