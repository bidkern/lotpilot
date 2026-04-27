import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { buildMetaPopupHtml } from "@/lib/meta-popup";
import { requireApiRole } from "@/lib/request-auth";
import { createMetaOAuthUrl } from "@/lib/services/meta-service";

export async function GET(request: Request) {
  const authResult = await requireApiRole([UserRole.AGENT]);
  if (authResult.error) {
    return authResult.error;
  }

  const requestUrl = new URL(request.url);
  const popupMode = requestUrl.searchParams.get("mode") === "popup";

  try {
    const redirectUrl = await createMetaOAuthUrl({
      popup: popupMode,
      tenantId: authResult.user!.tenantId!,
      userId: authResult.user!.id,
    });

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start the Meta connection flow.";

    if (popupMode) {
      return new NextResponse(
        buildMetaPopupHtml({
          message,
          status: "error",
        }),
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    }

    return NextResponse.redirect(
      new URL(`/admin/facebook?messagingError=${encodeURIComponent(message)}`, env.APP_URL),
    );
  }
}
