import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  buildFacebookOauthUrl,
  FACEBOOK_PAGE_SCOPES,
  fetchFacebookManagedPages,
  fetchFacebookProfile,
  getFacebookOauthMissingRequirements,
  exchangeFacebookCodeForAccessToken,
} from "@/lib/facebook-oauth";
import { encryptSecret } from "@/lib/secrets";
import type {
  WorkspaceChildAccount,
  WorkspaceDealership,
  WorkspaceFacebookConnection,
  WorkspaceInventorySource,
  WorkspaceParentAccount,
  WorkspaceState,
} from "@/lib/workspace-types";
import { DEFAULT_WORKSPACE_STATE } from "@/lib/workspace-types";

const DATA_DIRECTORY = path.join(process.cwd(), "runtime-data");
const DATA_FILE = path.join(DATA_DIRECTORY, "starter-workspace.json");
const OAUTH_STATE_TTL_MS = 1000 * 60 * 20;

interface StarterFacebookSecretRecord {
  childAccountId: string;
  encryptedUserAccessToken: string;
  encryptedPageAccessTokens: Record<string, string>;
  expiresAt?: string;
  storedAt: string;
}

interface StarterFacebookOauthState {
  id: string;
  childAccountId: string;
  createdAt: string;
}

interface StarterWorkspaceDocument {
  version: 1;
  workspace: WorkspaceState;
  oauthStates: StarterFacebookOauthState[];
  facebookSecrets: Record<string, StarterFacebookSecretRecord>;
  updatedAt: string;
}

function cloneWorkspaceState() {
  return structuredClone(DEFAULT_WORKSPACE_STATE);
}

function createDefaultDocument(): StarterWorkspaceDocument {
  return {
    version: 1,
    workspace: cloneWorkspaceState(),
    oauthStates: [],
    facebookSecrets: {},
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDocument(document: Partial<StarterWorkspaceDocument> | null) {
  const baseDocument = createDefaultDocument();

  if (!document || typeof document !== "object") {
    return baseDocument;
  }

  return {
    version: 1 as const,
    workspace: {
      parentAccount: document.workspace?.parentAccount ?? null,
      dealerships: document.workspace?.dealerships ?? [],
      childAccounts: document.workspace?.childAccounts ?? [],
      facebookConnections: document.workspace?.facebookConnections ?? [],
      inventorySources: document.workspace?.inventorySources ?? [],
    },
    oauthStates: (document.oauthStates ?? []).filter((entry) => {
      const createdAt = Date.parse(entry.createdAt);
      return Number.isFinite(createdAt) && Date.now() - createdAt < OAUTH_STATE_TTL_MS;
    }),
    facebookSecrets: document.facebookSecrets ?? {},
    updatedAt: document.updatedAt ?? baseDocument.updatedAt,
  };
}

async function ensureDocumentFile() {
  await mkdir(DATA_DIRECTORY, { recursive: true });

  try {
    await readFile(DATA_FILE, "utf8");
  } catch {
    await writeFile(DATA_FILE, JSON.stringify(createDefaultDocument(), null, 2), "utf8");
  }
}

async function readDocument() {
  await ensureDocumentFile();

  try {
    const rawDocument = await readFile(DATA_FILE, "utf8");
    const parsedDocument = JSON.parse(rawDocument) as Partial<StarterWorkspaceDocument>;
    return normalizeDocument(parsedDocument);
  } catch {
    const fallbackDocument = createDefaultDocument();
    await writeDocument(fallbackDocument);
    return fallbackDocument;
  }
}

async function writeDocument(document: StarterWorkspaceDocument) {
  const normalizedDocument = normalizeDocument({
    ...document,
    updatedAt: new Date().toISOString(),
  });

  await ensureDocumentFile();
  await writeFile(DATA_FILE, JSON.stringify(normalizedDocument, null, 2), "utf8");

  return normalizedDocument;
}

let documentQueue = Promise.resolve();

async function withDocumentLock<T>(
  callback: (document: StarterWorkspaceDocument) => Promise<T> | T,
) {
  const run = documentQueue.then(async () => {
    const document = await readDocument();
    return callback(document);
  });

  documentQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

function requireParentAccount(workspace: WorkspaceState) {
  if (!workspace.parentAccount) {
    throw new Error("Create a parent account before adding more setup records.");
  }

  return workspace.parentAccount;
}

function requireChildAccount(workspace: WorkspaceState, childAccountId: string) {
  const childAccount = workspace.childAccounts.find(
    (account) => account.id === childAccountId,
  );

  if (!childAccount) {
    throw new Error("Child account not found.");
  }

  return childAccount;
}

function requireDealership(workspace: WorkspaceState, dealershipId: string) {
  const dealership = workspace.dealerships.find((item) => item.id === dealershipId);

  if (!dealership) {
    throw new Error("Dealership not found.");
  }

  return dealership;
}

function getConnectionLabel(childAccount: WorkspaceChildAccount) {
  return `${childAccount.firstName} ${childAccount.lastName}`.trim() || "Facebook account";
}

function findConnectionByChildId(
  workspace: WorkspaceState,
  childAccountId: string,
) {
  return workspace.facebookConnections.find(
    (connection) => connection.childAccountId === childAccountId,
  );
}

function upsertFacebookConnection(
  workspace: WorkspaceState,
  childAccountId: string,
  update: Partial<WorkspaceFacebookConnection>,
) {
  const existingConnection = findConnectionByChildId(workspace, childAccountId);
  const nextConnection: WorkspaceFacebookConnection = {
    id: existingConnection?.id ?? randomUUID(),
    childAccountId,
    accountLabel: update.accountLabel ?? existingConnection?.accountLabel ?? "",
    profileUrl: update.profileUrl ?? existingConnection?.profileUrl ?? "",
    status: update.status ?? existingConnection?.status ?? "PENDING",
    connectionMode:
      update.connectionMode ?? existingConnection?.connectionMode ?? "MANUAL",
    providerAccountId:
      update.providerAccountId ?? existingConnection?.providerAccountId,
    grantedScopes: update.grantedScopes ?? existingConnection?.grantedScopes ?? [],
    availablePages: update.availablePages ?? existingConnection?.availablePages ?? [],
    selectedPageId: update.selectedPageId ?? existingConnection?.selectedPageId,
    selectedPageName: update.selectedPageName ?? existingConnection?.selectedPageName,
    lastError: update.lastError,
    attachedAt: existingConnection?.attachedAt ?? new Date().toISOString(),
  };

  workspace.facebookConnections = [
    ...workspace.facebookConnections.filter(
      (connection) => connection.childAccountId !== childAccountId,
    ),
    nextConnection,
  ];

  return nextConnection;
}

export async function getStarterWorkspaceState() {
  const document = await readDocument();
  return document.workspace;
}

export async function resetStarterWorkspaceState() {
  const document = await writeDocument(createDefaultDocument());
  return document.workspace;
}

export async function createStarterParentAccount(input: {
  name: string;
  billingEmail: string;
}) {
  return withDocumentLock(async (document) => {
    const parentAccount: WorkspaceParentAccount = {
      id: randomUUID(),
      name: input.name.trim(),
      billingEmail: input.billingEmail.trim(),
      createdAt: new Date().toISOString(),
    };

    document.workspace = {
      parentAccount,
      dealerships: [],
      childAccounts: [],
      facebookConnections: [],
      inventorySources: [],
    };
    document.oauthStates = [];
    document.facebookSecrets = {};

    const savedDocument = await writeDocument(document);
    return savedDocument.workspace;
  });
}

export async function updateStarterRegistrationEmailStatus(input: {
  status: NonNullable<WorkspaceParentAccount["registrationEmailStatus"]>;
  deliveryMode?: WorkspaceParentAccount["registrationEmailDeliveryMode"];
  lastError?: string;
  sentAt?: string;
}) {
  return withDocumentLock(async (document) => {
    const parentAccount = requireParentAccount(document.workspace);

    parentAccount.registrationEmailStatus = input.status;
    parentAccount.registrationEmailDeliveryMode = input.deliveryMode;
    parentAccount.registrationEmailSentAt = input.sentAt;
    parentAccount.registrationEmailLastError = input.lastError;

    const savedDocument = await writeDocument(document);
    return savedDocument.workspace;
  });
}

export async function createStarterDealership(input: {
  name: string;
  city: string;
  state: string;
  timezone: string;
}) {
  return withDocumentLock(async (document) => {
    const parentAccount = requireParentAccount(document.workspace);

    const dealership: WorkspaceDealership = {
      id: randomUUID(),
      parentAccountId: parentAccount.id,
      name: input.name.trim(),
      city: input.city.trim(),
      state: input.state.trim(),
      timezone: input.timezone.trim(),
      createdAt: new Date().toISOString(),
    };

    document.workspace.dealerships = [...document.workspace.dealerships, dealership];

    const savedDocument = await writeDocument(document);
    return savedDocument.workspace;
  });
}

export async function createStarterChildAccount(input: {
  dealershipId?: string;
  firstName: string;
  lastName: string;
  email: string;
  role: WorkspaceChildAccount["role"];
}) {
  return withDocumentLock(async (document) => {
    const parentAccount = requireParentAccount(document.workspace);

    if (input.dealershipId) {
      requireDealership(document.workspace, input.dealershipId);
    }

    const childAccount: WorkspaceChildAccount = {
      id: randomUUID(),
      parentAccountId: parentAccount.id,
      dealershipId: input.dealershipId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim(),
      role: input.role,
      createdAt: new Date().toISOString(),
    };

    document.workspace.childAccounts = [
      ...document.workspace.childAccounts,
      childAccount,
    ];

    const savedDocument = await writeDocument(document);
    return savedDocument.workspace;
  });
}

export async function upsertStarterManualFacebookConnection(input: {
  childAccountId: string;
  accountLabel: string;
  profileUrl: string;
  status: WorkspaceFacebookConnection["status"];
}) {
  return withDocumentLock(async (document) => {
    requireParentAccount(document.workspace);
    const childAccount = requireChildAccount(document.workspace, input.childAccountId);

    upsertFacebookConnection(document.workspace, childAccount.id, {
      accountLabel: input.accountLabel.trim(),
      profileUrl: input.profileUrl.trim(),
      status: input.status,
      connectionMode: "MANUAL",
      grantedScopes: [],
      availablePages: [],
      selectedPageId: undefined,
      selectedPageName: undefined,
      lastError: undefined,
    });

    const savedDocument = await writeDocument(document);
    return savedDocument.workspace;
  });
}

export async function createStarterInventorySource(input: {
  dealershipId: string;
  type: WorkspaceInventorySource["type"];
  provider: string;
  label: string;
  status: WorkspaceInventorySource["status"];
  baseUrl: string;
  credentialsRef?: string;
  pollIntervalMinutes?: number;
}) {
  return withDocumentLock(async (document) => {
    const parentAccount = requireParentAccount(document.workspace);
    requireDealership(document.workspace, input.dealershipId);

    const inventorySource: WorkspaceInventorySource = {
      id: randomUUID(),
      parentAccountId: parentAccount.id,
      dealershipId: input.dealershipId,
      type: input.type,
      provider: input.provider.trim(),
      label: input.label.trim(),
      status: input.status,
      baseUrl: input.baseUrl.trim(),
      credentialsRef: input.credentialsRef?.trim() || undefined,
      pollIntervalMinutes: input.pollIntervalMinutes,
      createdAt: new Date().toISOString(),
    };

    document.workspace.inventorySources = [
      ...document.workspace.inventorySources,
      inventorySource,
    ];

    const savedDocument = await writeDocument(document);
    return savedDocument.workspace;
  });
}

export async function beginStarterFacebookOauth(childAccountId: string) {
  const missingRequirements = getFacebookOauthMissingRequirements();

  if (missingRequirements.length > 0) {
    throw new Error(
      `Facebook OAuth is not configured. Missing ${missingRequirements.join(", ")}.`,
    );
  }

  return withDocumentLock(async (document) => {
    requireParentAccount(document.workspace);
    requireChildAccount(document.workspace, childAccountId);

    const state = randomUUID();
    document.oauthStates = [
      ...document.oauthStates.filter((entry) => {
        const createdAt = Date.parse(entry.createdAt);
        return Number.isFinite(createdAt) && Date.now() - createdAt < OAUTH_STATE_TTL_MS;
      }),
      {
        id: state,
        childAccountId,
        createdAt: new Date().toISOString(),
      },
    ];

    await writeDocument(document);

    return {
      state,
      authUrl: buildFacebookOauthUrl(state),
    };
  });
}

async function popStarterFacebookOauthState(state: string) {
  return withDocumentLock(async (document) => {
    const stateEntry = document.oauthStates.find((entry) => entry.id === state);
    document.oauthStates = document.oauthStates.filter((entry) => entry.id !== state);
    await writeDocument(document);
    return stateEntry ?? null;
  });
}

export async function recordStarterFacebookOauthError(input: {
  childAccountId: string;
  message: string;
}) {
  return withDocumentLock(async (document) => {
    const childAccount = requireChildAccount(document.workspace, input.childAccountId);

    upsertFacebookConnection(document.workspace, childAccount.id, {
      accountLabel: getConnectionLabel(childAccount),
      profileUrl: "",
      status: "DISCONNECTED",
      connectionMode: "OAUTH",
      lastError: input.message,
    });

    const savedDocument = await writeDocument(document);
    return savedDocument.workspace;
  });
}

export async function completeStarterFacebookOauth(input: {
  state: string;
  code: string;
}) {
  const stateEntry = await popStarterFacebookOauthState(input.state);

  if (!stateEntry) {
    throw new Error("Facebook sign-in state is missing or expired. Start the connection again.");
  }

  try {
    const tokenPayload = await exchangeFacebookCodeForAccessToken(input.code);
    const profile = await fetchFacebookProfile(tokenPayload.access_token);
    const pages = await fetchFacebookManagedPages(tokenPayload.access_token);

    return withDocumentLock(async (document) => {
      const childAccount = requireChildAccount(
        document.workspace,
        stateEntry.childAccountId,
      );

      const selectedPage = pages.length === 1 ? pages[0] : undefined;

      const connection = upsertFacebookConnection(document.workspace, childAccount.id, {
        accountLabel: profile.name || getConnectionLabel(childAccount),
        profileUrl: `https://facebook.com/${profile.id}`,
        status: selectedPage ? "CONNECTED" : "PENDING",
        connectionMode: "OAUTH",
        providerAccountId: profile.id,
        grantedScopes: [...FACEBOOK_PAGE_SCOPES],
        availablePages: pages.map((page) => ({
          id: page.id,
          name: page.name,
          username: page.username,
          selected: page.id === selectedPage?.id,
        })),
        selectedPageId: selectedPage?.id,
        selectedPageName: selectedPage?.name,
        lastError:
          pages.length === 0
            ? "Meta returned no managed Pages for this account. Connect a Page to use the official inbox lane."
            : undefined,
      });

      document.facebookSecrets[connection.id] = {
        childAccountId: childAccount.id,
        encryptedUserAccessToken: encryptSecret(tokenPayload.access_token),
        encryptedPageAccessTokens: Object.fromEntries(
          pages
            .filter((page) => page.access_token)
            .map((page) => [page.id, encryptSecret(page.access_token as string)]),
        ),
        expiresAt: tokenPayload.expires_in
          ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString()
          : undefined,
        storedAt: new Date().toISOString(),
      };

      const savedDocument = await writeDocument(document);

      return {
        workspace: savedDocument.workspace,
        connection,
      };
    });
  } catch (error) {
    await recordStarterFacebookOauthError({
      childAccountId: stateEntry.childAccountId,
      message:
        error instanceof Error
          ? error.message
          : "Facebook OAuth failed before the Page connection could be saved.",
    });

    throw error;
  }
}

export async function selectStarterFacebookPage(input: {
  connectionId: string;
  pageId: string;
}) {
  return withDocumentLock(async (document) => {
    const connection = document.workspace.facebookConnections.find(
      (item) => item.id === input.connectionId,
    );

    if (!connection) {
      throw new Error("Facebook connection not found.");
    }

    const selectedPage = connection.availablePages.find(
      (page) => page.id === input.pageId,
    );

    if (!selectedPage) {
      throw new Error("Facebook Page not found for this connection.");
    }

    connection.availablePages = connection.availablePages.map((page) => ({
      ...page,
      selected: page.id === selectedPage.id,
    }));
    connection.selectedPageId = selectedPage.id;
    connection.selectedPageName = selectedPage.name;
    connection.status = "CONNECTED";
    connection.lastError = undefined;

    const savedDocument = await writeDocument(document);
    return savedDocument.workspace;
  });
}
