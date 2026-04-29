import { NextRequest, NextResponse } from "next/server";

import { getAppBaseUrl } from "@/lib/app-url";
import { completeStarterFacebookOauth } from "@/lib/starter-persistence";

function buildSetupRedirect(
  status: string,
  options?: {
    connectionId?: string;
    message?: string;
  },
) {
  const redirectUrl = new URL("/", getAppBaseUrl());

  redirectUrl.searchParams.set("facebook", status);

  if (options?.connectionId) {
    redirectUrl.searchParams.set("connectionId", options.connectionId);
  }

  if (options?.message) {
    redirectUrl.searchParams.set("message", options.message);
  }

  return redirectUrl;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim();
  const state = request.nextUrl.searchParams.get("state")?.trim();
  const error = request.nextUrl.searchParams.get("error");
  const errorDescription = request.nextUrl.searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(
      buildSetupRedirect("error", {
        message: errorDescription || "Facebook rejected the login request.",
      }),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      buildSetupRedirect("error", {
        message: "Facebook callback was missing code or state.",
      }),
    );
  }

  try {
    const { connection } = await completeStarterFacebookOauth({ code, state });

    if (connection.status === "CONNECTED") {
      return NextResponse.redirect(
        buildSetupRedirect("connected", {
          connectionId: connection.id,
          message: `Connected ${connection.accountLabel} and selected ${connection.selectedPageName}.`,
        }),
      );
    }

    return NextResponse.redirect(
      buildSetupRedirect("page-required", {
        connectionId: connection.id,
        message:
          connection.lastError ||
          "Select a managed Facebook Page to finish the connection.",
      }),
    );
  } catch (oauthError) {
    return NextResponse.redirect(
      buildSetupRedirect("error", {
        message:
          oauthError instanceof Error
            ? oauthError.message
            : "Unable to complete Facebook OAuth.",
      }),
    );
  }
}
