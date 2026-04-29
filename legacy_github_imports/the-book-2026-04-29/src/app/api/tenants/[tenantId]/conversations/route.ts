import { NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { employees } from "@/lib/demo-data";
import { getSalesFloorState } from "@/lib/sales-floor-persistence";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  const salesFloor = await getSalesFloorState(parsedParams.data.tenantId);

  return NextResponse.json({
    ok: true,
    mode: "demo",
    tenantId: parsedParams.data.tenantId,
    conversations: salesFloor.conversations,
    employees,
    setupRequired: false,
  });
}
