import { getAppBaseUrl } from "@/lib/app-url";
import { getResolvedIntegrationConfig } from "@/lib/integration-config";
import { encryptionConfigured } from "@/lib/secrets";

export const FACEBOOK_PAGE_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
] as const;

export interface FacebookProfile {
  id: string;
  name: string;
}

export interface FacebookManagedPage {
  id: string;
  name: string;
  username?: string;
  access_token?: string;
}

export function getFacebookGraphVersion() {
  return process.env.FACEBOOK_GRAPH_VERSION?.trim() || "v23.0";
}

export function getFacebookOauthCallbackUrl() {
  return `${getAppBaseUrl()}/api/setup/facebook/oauth/callback`;
}

export function getFacebookOauthMissingRequirements() {
  const missingRequirements: string[] = [];

  const config = getResolvedIntegrationConfig();
  const appId = config.facebookAppId;
  const appSecret = config.facebookAppSecret;

  if (!appId) {
    missingRequirements.push("FACEBOOK_APP_ID");
  }

  if (!appSecret) {
    missingRequirements.push("FACEBOOK_APP_SECRET");
  }

  if (!encryptionConfigured()) {
    missingRequirements.push("ENCRYPTION_KEY");
  }

  return missingRequirements;
}

export function facebookOauthConfigured() {
  return getFacebookOauthMissingRequirements().length === 0;
}

export function buildFacebookOauthUrl(state: string) {
  const appId = getResolvedIntegrationConfig().facebookAppId;

  if (!appId || !facebookOauthConfigured()) {
    throw new Error(
      `Facebook OAuth is not configured. Missing ${getFacebookOauthMissingRequirements().join(", ")}.`,
    );
  }

  const url = new URL(
    `https://www.facebook.com/${getFacebookGraphVersion()}/dialog/oauth`,
  );

  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", getFacebookOauthCallbackUrl());
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", FACEBOOK_PAGE_SCOPES.join(","));
  url.searchParams.set("auth_type", "rerequest");

  return url.toString();
}

async function parseGraphResponse<T>(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message || fallbackMessage);
  }

  if (!payload) {
    throw new Error(fallbackMessage);
  }

  return payload as T;
}

export async function exchangeFacebookCodeForAccessToken(code: string) {
  const config = getResolvedIntegrationConfig();
  const appId = config.facebookAppId;
  const appSecret = config.facebookAppSecret;

  if (!appId || !appSecret || !facebookOauthConfigured()) {
    throw new Error(
      `Facebook OAuth is not configured. Missing ${getFacebookOauthMissingRequirements().join(", ")}.`,
    );
  }

  const url = new URL(
    `https://graph.facebook.com/${getFacebookGraphVersion()}/oauth/access_token`,
  );

  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", getFacebookOauthCallbackUrl());
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  return parseGraphResponse<{
    access_token: string;
    token_type?: string;
    expires_in?: number;
  }>(await fetch(url, { cache: "no-store" }), "Facebook token exchange failed.");
}

export async function fetchFacebookProfile(accessToken: string) {
  const url = new URL(
    `https://graph.facebook.com/${getFacebookGraphVersion()}/me`,
  );

  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  return parseGraphResponse<FacebookProfile>(
    await fetch(url, { cache: "no-store" }),
    "Facebook profile lookup failed.",
  );
}

export async function fetchFacebookManagedPages(accessToken: string) {
  const url = new URL(
    `https://graph.facebook.com/${getFacebookGraphVersion()}/me/accounts`,
  );

  url.searchParams.set("fields", "id,name,username,access_token");
  url.searchParams.set("access_token", accessToken);

  const payload = await parseGraphResponse<{ data?: FacebookManagedPage[] }>(
    await fetch(url, { cache: "no-store" }),
    "Facebook Page lookup failed.",
  );

  return payload.data ?? [];
}
