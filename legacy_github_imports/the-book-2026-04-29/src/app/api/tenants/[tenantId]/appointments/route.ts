import { NextResponse } from "next/server";

import { getAppointmentSnapshot } from "@/lib/appointment-persistence";
import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  const appointments = await getAppointmentSnapshot(parsedParams.data.tenantId);

  return NextResponse.json({
    ok: true,
    tenantId: parsedParams.data.tenantId,
    appointments,
  });
}
