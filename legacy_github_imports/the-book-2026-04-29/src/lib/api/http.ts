import { NextResponse } from "next/server";

import { tenantRouteParamsSchema } from "@/lib/validation";

export async function parseTenantParams(
  paramsPromise: Promise<{ tenantId: string }>,
) {
  const params = await paramsPromise;
  return tenantRouteParamsSchema.safeParse(params);
}

export function jsonBadRequest(message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: message, details },
    { status: 400 },
  );
}
