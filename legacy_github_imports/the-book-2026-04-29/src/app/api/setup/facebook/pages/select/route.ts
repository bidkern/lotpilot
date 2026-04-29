import { NextRequest, NextResponse } from "next/server";

import { jsonBadRequest } from "@/lib/api/http";
import { selectStarterFacebookPage } from "@/lib/starter-persistence";
import { setupFacebookPageSelectionSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsedPayload = setupFacebookPageSelectionSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return jsonBadRequest(
      "Invalid Facebook Page selection payload.",
      parsedPayload.error.flatten(),
    );
  }

  try {
    const workspace = await selectStarterFacebookPage(parsedPayload.data);

    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    return jsonBadRequest(
      error instanceof Error ? error.message : "Unable to select Facebook Page.",
    );
  }
}
