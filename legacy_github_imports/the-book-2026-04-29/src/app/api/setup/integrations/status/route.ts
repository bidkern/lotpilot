import { NextResponse } from "next/server";

import {
  FACEBOOK_PAGE_SCOPES,
  facebookOauthConfigured,
  getFacebookOauthCallbackUrl,
  getFacebookOauthMissingRequirements,
} from "@/lib/facebook-oauth";
import {
  getEmailDeliveryMode,
  emailConfigured,
  getEmailMissingRequirements,
} from "@/lib/email";
import { getResolvedIntegrationConfig } from "@/lib/integration-config";

export async function GET() {
  const config = getResolvedIntegrationConfig();

  return NextResponse.json({
    ok: true,
    integrations: {
      facebook: {
        configured: facebookOauthConfigured(),
        missingRequirements: getFacebookOauthMissingRequirements(),
        callbackUrl: getFacebookOauthCallbackUrl(),
        scopes: [...FACEBOOK_PAGE_SCOPES],
      },
      email: {
        configured: emailConfigured(),
        mode: getEmailDeliveryMode(),
        missingRequirements: getEmailMissingRequirements(),
        fromAddress: config.smtpFrom || "local-outbox@the-book.local",
        outboxUrl: "/api/setup/email/outbox",
      },
    },
  });
}
