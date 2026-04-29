"use client";

import { useSyncExternalStore } from "react";

import type {
  WorkspaceChildAccount,
  WorkspaceFacebookConnection,
  WorkspaceInventorySource,
  WorkspaceState,
} from "@/lib/workspace-types";
import { DEFAULT_WORKSPACE_STATE } from "@/lib/workspace-types";

interface WorkspaceApiResponse {
  ok: boolean;
  workspace: WorkspaceState;
  error?: string;
}

let workspaceState: WorkspaceState = DEFAULT_WORKSPACE_STATE;
let workspaceLoaded = false;
let workspaceRequest: Promise<WorkspaceState> | null = null;

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setWorkspaceState(nextState: WorkspaceState) {
  workspaceState = nextState;
  workspaceLoaded = true;
  emit();
}

async function parseWorkspaceResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | WorkspaceApiResponse
    | { error?: string; message?: string }
    | null;

  if (!response.ok || !payload || !("workspace" in payload)) {
    const message =
      payload && "message" in payload ? payload.message : undefined;

    throw new Error(
      payload?.error ||
        message ||
        "Workspace request failed. Refresh and try again.",
    );
  }

  return payload.workspace;
}

async function workspaceRequestJson(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const workspace = await parseWorkspaceResponse(response);
  setWorkspaceState(workspace);
  return workspace;
}

export async function refreshWorkspace() {
  const nextWorkspace = await workspaceRequestJson("/api/setup/workspace", {
    method: "GET",
  });

  return nextWorkspace;
}

function ensureWorkspaceLoaded() {
  if (typeof window === "undefined" || workspaceLoaded || workspaceRequest) {
    return;
  }

  workspaceRequest = refreshWorkspace().finally(() => {
    workspaceRequest = null;
  });
}

export function getWorkspaceSnapshot() {
  ensureWorkspaceLoaded();
  return workspaceState;
}

export function subscribeToWorkspace(listener: () => void) {
  ensureWorkspaceLoaded();
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useWorkspace() {
  return useSyncExternalStore(
    subscribeToWorkspace,
    getWorkspaceSnapshot,
    () => DEFAULT_WORKSPACE_STATE,
  );
}

export async function createParentAccount(input: {
  name: string;
  billingEmail: string;
}) {
  return workspaceRequestJson("/api/setup/parent-account", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function addDealership(input: {
  name: string;
  city: string;
  state: string;
  timezone: string;
}) {
  return workspaceRequestJson("/api/setup/dealerships", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function addChildAccount(input: {
  dealershipId?: string;
  firstName: string;
  lastName: string;
  email: string;
  role: WorkspaceChildAccount["role"];
}) {
  return workspaceRequestJson("/api/setup/child-accounts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function attachFacebookConnection(input: {
  childAccountId: string;
  accountLabel: string;
  profileUrl: string;
  status: WorkspaceFacebookConnection["status"];
}) {
  return workspaceRequestJson("/api/setup/facebook/manual", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function selectFacebookPage(input: {
  connectionId: string;
  pageId: string;
}) {
  return workspaceRequestJson("/api/setup/facebook/pages/select", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function addInventorySource(input: {
  dealershipId: string;
  type: WorkspaceInventorySource["type"];
  provider: string;
  label: string;
  status: WorkspaceInventorySource["status"];
  baseUrl: string;
  credentialsRef?: string;
  pollIntervalMinutes?: number;
}) {
  return workspaceRequestJson("/api/setup/inventory-sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function resetWorkspace() {
  return workspaceRequestJson("/api/setup/workspace", {
    method: "DELETE",
  });
}

export function getFacebookOauthStartPath(childAccountId: string) {
  const searchParams = new URLSearchParams({
    childAccountId,
  });

  return `/api/setup/facebook/oauth/start?${searchParams.toString()}`;
}
