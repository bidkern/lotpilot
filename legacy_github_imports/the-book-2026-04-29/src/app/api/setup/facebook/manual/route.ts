import { NextRequest, NextResponse } from "next/server";

import { jsonBadRequest } from "@/lib/api/http";
import { upsertStarterManualFacebookConnection } from "@/lib/starter-persistence";
import { setupManualFacebookSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsedPayload = setupManualFacebookSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return jsonBadRequest(
      "Invalid Facebook manual connection payload.",
      parsedPayload.error.flatten(),
    );
  }

  try {
    const workspace = await upsertStarterManualFacebookConnection(parsedPayload.data);

    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    return jsonBadRequest(
      error instanceof Error ? error.message : "Unable to save Facebook connection.",
    );
  }
}
