import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { env } from "@/lib/env";
import { buildMetaPopupHtml } from "@/lib/meta-popup";
import { completeMetaOAuth, isMetaPopupState } from "@/lib/services/meta-service";

function buildAdminRedirect(searchParams: Record<string, string>) {
  const url = new URL("/admin/facebook", env.APP_URL);

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  return url;
}

export async function GET(request: Request) {
  const session = await auth();
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const errorReason = requestUrl.searchParams.get("error_reason");
  const errorDescription = requestUrl.searchParams.get("error_description");
  const popupMode = isMetaPopupState(state);

  function popupOrRedirect(payload: {
    message: string;
    status: "connected" | "error" | "select-page";
  }) {
    if (popupMode) {
      return new NextResponse(buildMetaPopupHtml(payload), {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    }

    if (payload.status === "error") {
      return NextResponse.redirect(buildAdminRedirect({
        messagingError: payload.message,
      }));
    }

    return NextResponse.redirect(buildAdminRedirect({
      messagingStatus: payload.status,
    }));
  }

  if (!session?.user?.id || !session.user.tenantId) {
    return popupOrRedirect({
      message: "Please sign back into LotPilot before completing Meta connection.",
      status: "error",
    });
  }

  if (error) {
    return popupOrRedirect({
      message: errorDescription || errorReason || error,
      status: "error",
    });
  }

  if (!code || !state) {
    return popupOrRedirect({
      message: "Meta did not return the required authorization details.",
      status: "error",
    });
  }

  try {
    const result = await completeMetaOAuth({
      code,
      state,
      tenantId: session.user.tenantId,
      userId: session.user.id,
    });

    return popupOrRedirect({
      message:
        result.autoConnected
          ? "Facebook Page connected successfully."
          : "Choose which Facebook Page should power automated replies for this workspace.",
      status: result.autoConnected ? "connected" : "select-page",
    });
  } catch (callbackError) {
    return popupOrRedirect({
      message:
        callbackError instanceof Error
          ? callbackError.message
          : "Meta connection could not be completed.",
      status: "error",
    });
  }
}
