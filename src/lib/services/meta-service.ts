import {
  IntegrationStatus,
  IdempotencyStatus,
  MessagingChannel,
  MessagingConnectionStatus,
  type MetaAuthAccount,
  type MessagingConnection,
  type Prisma,
} from "@prisma/client";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

import { createAuditLog } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { completeIdempotencyKey, reserveIdempotencyKey } from "@/lib/services/idempotency-service";
import { assertTenantMessagingAccess } from "@/lib/services/subscription-service";

type MetaOAuthPage = {
  access_token?: string;
  category?: string;
  id: string;
  name: string;
  tasks?: string[];
  username?: string;
};

type MetaUserProfile = {
  id: string;
  name?: string;
};

type AvailableMetaPage = {
  category: string | null;
  id: string;
  name: string;
  pageAccessTokenEncrypted: string;
  tasks: string[];
  username: string | null;
};

const DEFAULT_META_SCOPES = [
  "pages_manage_metadata",
  "pages_messaging",
  "pages_read_engagement",
  "pages_show_list",
] as const;

const META_POPUP_STATE_PREFIX = "popup_";

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function getMetaRedirectUri() {
  return env.META_REDIRECT_URI || `${env.APP_URL}/api/meta/callback`;
}

function assertMetaConfigured() {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new Error("Meta app credentials are not configured yet.");
  }
}

function buildGraphUrl(path: string, searchParams?: Record<string, string>) {
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${normalizedPath}`);

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  return url;
}

async function readGraphJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Meta Graph request failed.");
  }

  return payload;
}

async function exchangeCodeForUserAccessToken(code: string) {
  assertMetaConfigured();

  const url = buildGraphUrl("oauth/access_token", {
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
    code,
    redirect_uri: getMetaRedirectUri(),
  });

  return readGraphJson<{ access_token: string }>(url);
}

async function fetchManagedPages(userAccessToken: string) {
  const url = buildGraphUrl("me/accounts", {
    access_token: userAccessToken,
    fields: "id,name,username,category,access_token,tasks",
  });

  const payload = await readGraphJson<{ data?: MetaOAuthPage[] }>(url);
  return payload.data ?? [];
}

async function fetchMetaUserProfile(userAccessToken: string) {
  const url = buildGraphUrl("me", {
    access_token: userAccessToken,
    fields: "id,name",
  });

  return readGraphJson<MetaUserProfile>(url);
}

function serializeAvailablePage(page: MetaOAuthPage): AvailableMetaPage {
  if (!page.access_token) {
    throw new Error(`Meta did not return a page access token for ${page.name}.`);
  }

  return {
    category: page.category ?? null,
    id: page.id,
    name: page.name,
    pageAccessTokenEncrypted: encryptSecret(page.access_token),
    tasks: page.tasks ?? [],
    username: page.username ?? null,
  };
}

function readAvailablePages(account: Pick<MetaAuthAccount, "metadata">) {
  if (!account.metadata || typeof account.metadata !== "object" || Array.isArray(account.metadata)) {
    return [] as AvailableMetaPage[];
  }

  const value = (account.metadata as Record<string, unknown>).availablePages;
  if (!Array.isArray(value)) {
    return [] as AvailableMetaPage[];
  }

  return value.filter((page): page is AvailableMetaPage => {
    return Boolean(
      page &&
        typeof page === "object" &&
        typeof (page as Record<string, unknown>).id === "string" &&
        typeof (page as Record<string, unknown>).name === "string" &&
        typeof (page as Record<string, unknown>).pageAccessTokenEncrypted === "string",
    );
  });
}

function sanitizeAvailablePagesForUi(account: Pick<MetaAuthAccount, "metadata">) {
  return readAvailablePages(account).map((page) => ({
    category: page.category,
    id: page.id,
    name: page.name,
    tasks: page.tasks,
    username: page.username,
  }));
}

async function subscribePageToMessenger(pageId: string, pageAccessToken: string) {
  const url = buildGraphUrl(`${pageId}/subscribed_apps`, {
    access_token: pageAccessToken,
    subscribed_fields: "messages,messaging_postbacks,message_deliveries,message_reads",
  });

  return readGraphJson<{ success?: boolean }>(url, {
    method: "POST",
  });
}

export async function createMetaOAuthUrl(input: {
  popup?: boolean;
  tenantId: string;
  userId: string;
}) {
  assertMetaConfigured();
  await assertTenantMessagingAccess(input.tenantId);

  const state = `${input.popup ? META_POPUP_STATE_PREFIX : ""}${randomUUID()}`;
  await reserveIdempotencyKey({
    expiresInSeconds: 10 * 60,
    key: state,
    payload: {
      redirectUri: getMetaRedirectUri(),
      userId: input.userId,
    },
    scope: "meta-oauth",
    tenantId: input.tenantId,
  });

  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.searchParams.set("client_id", env.META_APP_ID!);
  url.searchParams.set("redirect_uri", getMetaRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DEFAULT_META_SCOPES.join(","));
  url.searchParams.set("state", state);

  return url.toString();
}

export function isMetaPopupState(state: string | null | undefined) {
  return Boolean(state && state.startsWith(META_POPUP_STATE_PREFIX));
}

export async function completeMetaOAuth(input: {
  code: string;
  state: string;
  tenantId: string;
  userId: string;
}) {
  assertMetaConfigured();
  await assertTenantMessagingAccess(input.tenantId);

  const stateRecord = await prisma.idempotencyKey.findFirst({
    where: {
      key: input.state,
      scope: "meta-oauth",
      tenantId: input.tenantId,
    },
  });

  if (!stateRecord) {
    throw new Error("Meta OAuth state is invalid or expired.");
  }

  if (stateRecord.expiresAt && stateRecord.expiresAt < new Date()) {
    throw new Error("Meta OAuth state has expired. Please reconnect from LotPilot.");
  }

  if (stateRecord.status === IdempotencyStatus.COMPLETED) {
    throw new Error("This Meta OAuth attempt has already been completed.");
  }

  const tokenResponse = await exchangeCodeForUserAccessToken(input.code);
  const userProfile = await fetchMetaUserProfile(tokenResponse.access_token);
  const managedPages = await fetchManagedPages(tokenResponse.access_token);

  if (!managedPages.length) {
    throw new Error("No Facebook Pages were returned for this Meta account.");
  }

  const availablePages = managedPages.map(serializeAvailablePage);
  const metaAuthAccount = await prisma.metaAuthAccount.upsert({
    where: {
      tenantId_facebookUserId: {
        facebookUserId: userProfile.id,
        tenantId: input.tenantId,
      },
    },
    create: {
      accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
      createdById: input.userId,
      displayName: userProfile.name ?? undefined,
      facebookUserId: userProfile.id,
      grantedScopes: asJson(DEFAULT_META_SCOPES),
      metadata: asJson({
        availablePages,
      }),
      status:
        availablePages.length === 1 ? IntegrationStatus.ACTIVE : IntegrationStatus.ACTION_REQUIRED,
      tenantId: input.tenantId,
    },
    update: {
      accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
      displayName: userProfile.name ?? undefined,
      grantedScopes: asJson(DEFAULT_META_SCOPES),
      metadata: asJson({
        availablePages,
      }),
      status:
        availablePages.length === 1 ? IntegrationStatus.ACTIVE : IntegrationStatus.ACTION_REQUIRED,
    },
  });

  let connection: MessagingConnection | null = null;
  if (availablePages.length === 1) {
    connection = await activateMessagingPage({
      metaAuthAccountId: metaAuthAccount.id,
      pageId: availablePages[0].id,
      tenantId: input.tenantId,
      userId: input.userId,
    });
  }

  await completeIdempotencyKey({
    idempotencyKeyId: stateRecord.id,
    resourceId: metaAuthAccount.id,
    resourceType: "MetaAuthAccount",
  });

  await createAuditLog({
    action: "messaging.meta.oauth.completed",
    actorId: input.userId,
    entityId: metaAuthAccount.id,
    entityType: "MetaAuthAccount",
    metadata: asJson({
      autoConnected: availablePages.length === 1,
      pageCount: availablePages.length,
    }),
    summary:
      availablePages.length === 1
        ? `Connected Facebook Page ${availablePages[0].name}.`
        : `Meta OAuth completed and ${availablePages.length} Pages are ready for selection.`,
    tenantId: input.tenantId,
  });

  return {
    autoConnected: availablePages.length === 1,
    connection,
    metaAuthAccount,
    availablePages: sanitizeAvailablePagesForUi(metaAuthAccount),
  };
}

export async function activateMessagingPage(input: {
  metaAuthAccountId: string;
  pageId: string;
  tenantId: string;
  userId: string;
}) {
  const metaAuthAccount = await prisma.metaAuthAccount.findFirst({
    where: {
      id: input.metaAuthAccountId,
      tenantId: input.tenantId,
    },
  });

  if (!metaAuthAccount) {
    throw new Error("Meta account not found.");
  }

  const availablePages = readAvailablePages(metaAuthAccount);
  const selectedPage = availablePages.find((page) => page.id === input.pageId);

  if (!selectedPage) {
    throw new Error("The selected Facebook Page is no longer available for this connection.");
  }

  try {
    await subscribePageToMessenger(input.pageId, decryptSecret(selectedPage.pageAccessTokenEncrypted));
  } catch (error) {
    logger.warn("Unable to subscribe Facebook Page to Messenger webhooks", {
      metaAuthAccountId: metaAuthAccount.id,
      error: error instanceof Error ? error.message : String(error),
      pageId: input.pageId,
      tenantId: input.tenantId,
    });
  }

  const updatedConnection = await prisma.messagingConnection.upsert({
    where: {
      tenantId_channel_pageId: {
        channel: MessagingChannel.FACEBOOK_PAGE_MESSENGER,
        pageId: selectedPage.id,
        tenantId: input.tenantId,
      },
    },
    create: {
      channel: MessagingChannel.FACEBOOK_PAGE_MESSENGER,
      connectedAt: new Date(),
      createdById: input.userId,
      metaAuthAccountId: metaAuthAccount.id,
      pageAccessTokenEncrypted: selectedPage.pageAccessTokenEncrypted,
      pageId: selectedPage.id,
      pageName: selectedPage.name,
      pageUsername: selectedPage.username ?? undefined,
      permissions: asJson(selectedPage.tasks),
      postingEnabled: true,
      status: MessagingConnectionStatus.ACTIVE,
      tenantId: input.tenantId,
    },
    update: {
      connectedAt: new Date(),
      disconnectedAt: null,
      errorText: null,
      metaAuthAccountId: metaAuthAccount.id,
      pageAccessTokenEncrypted: selectedPage.pageAccessTokenEncrypted,
      pageId: selectedPage.id,
      pageName: selectedPage.name,
      pageUsername: selectedPage.username ?? undefined,
      permissions: asJson(selectedPage.tasks),
      postingEnabled: true,
      status: MessagingConnectionStatus.ACTIVE,
    },
  });

  await prisma.metaAuthAccount.update({
    where: {
      id: metaAuthAccount.id,
    },
    data: {
      status: IntegrationStatus.ACTIVE,
    },
  });

  await createAuditLog({
    action: "messaging.meta.page.activated",
    actorId: input.userId,
    entityId: updatedConnection.id,
    entityType: "MessagingConnection",
    metadata: asJson({
      pageId: selectedPage.id,
      pageName: selectedPage.name,
    }),
    summary: `Activated Facebook Page ${selectedPage.name}.`,
    tenantId: input.tenantId,
  });

  return updatedConnection;
}

export function getSafeMetaAuthAccountSummary(account: MetaAuthAccount) {
  return {
    availablePages: sanitizeAvailablePagesForUi(account),
    displayName: account.displayName,
    facebookUserId: account.facebookUserId,
    id: account.id,
    status: account.status,
    tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
  };
}

export function getSafeMessagingConnectionSummary(connection: MessagingConnection | null) {
  if (!connection) {
    return null;
  }

  return {
    aiRepliesEnabled: connection.aiRepliesEnabled,
    channel: connection.channel,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    errorText: connection.errorText,
    humanHandoffEnabled: connection.humanHandoffEnabled,
    id: connection.id,
    lastMessageAt: connection.lastMessageAt?.toISOString() ?? null,
    lastPublishedAt: connection.lastPublishedAt?.toISOString() ?? null,
    lastWebhookAt: connection.lastWebhookAt?.toISOString() ?? null,
    metaAuthAccountId: connection.metaAuthAccountId,
    pageId: connection.pageId,
    pageName: connection.pageName,
    pageUsername: connection.pageUsername,
    postingEnabled: connection.postingEnabled,
    status: connection.status,
  };
}

export function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string | null) {
  if (!signatureHeader || !env.META_APP_SECRET) {
    return false;
  }

  const [algorithm, signature] = signatureHeader.split("=");
  if (algorithm !== "sha256" || !signature) {
    return false;
  }

  const expected = createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex");
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function resolveWebhookVerification(url: URL) {
  if (!env.META_VERIFY_TOKEN) {
    throw new Error("Meta webhook verification is not configured.");
  }

  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || verifyToken !== env.META_VERIFY_TOKEN || !challenge) {
    throw new Error("Meta webhook verification failed.");
  }

  return challenge;
}

export async function recordMessagingWebhookEvent(input: {
  externalEventId?: string | null;
  messagingConnectionId?: string | null;
  payload: unknown;
  signature?: string | null;
  tenantId: string;
}) {
  return prisma.messagingWebhookEvent.create({
    data: {
      externalEventId: input.externalEventId ?? undefined,
      messagingConnectionId: input.messagingConnectionId ?? undefined,
      payload: asJson(input.payload),
      signature: input.signature ?? undefined,
      tenantId: input.tenantId,
    },
  });
}

export async function markMessagingWebhookProcessed(webhookEventId: string) {
  return prisma.messagingWebhookEvent.update({
    where: {
      id: webhookEventId,
    },
    data: {
      processedAt: new Date(),
    },
  });
}

export async function findMessagingConnectionByPageId(pageId: string) {
  return prisma.messagingConnection.findFirst({
    where: {
      pageId,
      status: MessagingConnectionStatus.ACTIVE,
    },
  });
}

export async function sendMessengerTextReply(input: {
  connectionId: string;
  recipientPsid: string;
  text: string;
}) {
  const connection = await prisma.messagingConnection.findUnique({
    where: {
      id: input.connectionId,
    },
  });

  if (!connection?.pageAccessTokenEncrypted) {
    throw new Error("This messaging connection does not have an active Page token.");
  }

  const url = buildGraphUrl("me/messages", {
    access_token: decryptSecret(connection.pageAccessTokenEncrypted),
  });

  return readGraphJson<{ message_id?: string; recipient_id?: string }>(url, {
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      message: {
        text: input.text,
      },
      recipient: {
        id: input.recipientPsid,
      },
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}
