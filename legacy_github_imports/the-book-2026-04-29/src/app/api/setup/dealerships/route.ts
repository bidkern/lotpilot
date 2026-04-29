import { NextRequest, NextResponse } from "next/server";

import { jsonBadRequest } from "@/lib/api/http";
import { createStarterDealership } from "@/lib/starter-persistence";
import { setupDealershipSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsedPayload = setupDealershipSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return jsonBadRequest("Invalid dealership payload.", parsedPayload.error.flatten());
  }

  try {
    const workspace = await createStarterDealership(parsedPayload.data);

    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    return jsonBadRequest(
      error instanceof Error ? error.message : "Unable to create dealership.",
    );
  }
}
