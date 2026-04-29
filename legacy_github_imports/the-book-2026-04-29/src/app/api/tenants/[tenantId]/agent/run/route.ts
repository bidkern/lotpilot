import { NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { runAutonomousAgentWorker } from "@/lib/autonomous-agent-worker";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  const result = await runAutonomousAgentWorker(parsedParams.data.tenantId);

  return NextResponse.json({
    ok: true,
    tenantId: parsedParams.data.tenantId,
    ...result,
  });
}
