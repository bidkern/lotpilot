import { NextRequest, NextResponse } from "next/server";

import { getAppBaseUrl } from "@/lib/app-url";
import { beginStarterFacebookOauth } from "@/lib/starter-persistence";

function buildSetupRedirect(status: string, message?: string) {
  const redirectUrl = new URL("/", getAppBaseUrl());

  redirectUrl.searchParams.set("facebook", status);

  if (message) {
    redirectUrl.searchParams.set("message", message);
  }

  return redirectUrl;
}

export async function GET(request: NextRequest) {
  const childAccountId = request.nextUrl.searchParams.get("childAccountId")?.trim();

  if (!childAccountId) {
    return NextResponse.redirect(
      buildSetupRedirect("error", "Choose a child account before connecting Facebook."),
    );
  }

  try {
    const { authUrl } = await beginStarterFacebookOauth(childAccountId);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    return NextResponse.redirect(
      buildSetupRedirect(
        "error",
        error instanceof Error ? error.message : "Unable to start Facebook OAuth.",
      ),
    );
  }
}
