export type WorkspaceMembershipRole =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "EMPLOYEE"
  | "BILLING";

export type WorkspaceFacebookConnectionStatus =
  | "CONNECTED"
  | "PENDING"
  | "DISCONNECTED";

export type WorkspaceFacebookConnectionMode = "MANUAL" | "OAUTH";

export type WorkspaceInventorySourceType = "API" | "FEED" | "WEBHOOK" | "MANUAL";

export type WorkspaceInventorySourceStatus =
  | "CONNECTED"
  | "DEGRADED"
  | "DISCONNECTED"
  | "ERROR";

export type WorkspaceRegistrationEmailStatus = "SENT" | "SKIPPED" | "FAILED";
export type WorkspaceRegistrationEmailDeliveryMode = "SMTP" | "LOCAL_OUTBOX";

export interface WorkspaceParentAccount {
  id: string;
  name: string;
  billingEmail: string;
  createdAt: string;
  registrationEmailStatus?: WorkspaceRegistrationEmailStatus;
  registrationEmailDeliveryMode?: WorkspaceRegistrationEmailDeliveryMode;
  registrationEmailSentAt?: string;
  registrationEmailLastError?: string;
}

export interface WorkspaceDealership {
  id: string;
  parentAccountId: string;
  name: string;
  city: string;
  state: string;
  timezone: string;
  createdAt: string;
}

export interface WorkspaceChildAccount {
  id: string;
  parentAccountId: string;
  dealershipId?: string;
  firstName: string;
  lastName: string;
  email: string;
  role: WorkspaceMembershipRole;
  createdAt: string;
}

export interface WorkspaceFacebookPage {
  id: string;
  name: string;
  username?: string;
  selected: boolean;
}

export interface WorkspaceFacebookConnection {
  id: string;
  childAccountId: string;
  accountLabel: string;
  profileUrl: string;
  status: WorkspaceFacebookConnectionStatus;
  connectionMode: WorkspaceFacebookConnectionMode;
  providerAccountId?: string;
  grantedScopes: string[];
  availablePages: WorkspaceFacebookPage[];
  selectedPageId?: string;
  selectedPageName?: string;
  lastError?: string;
  attachedAt: string;
}

export interface WorkspaceInventorySource {
  id: string;
  parentAccountId: string;
  dealershipId: string;
  type: WorkspaceInventorySourceType;
  provider: string;
  label: string;
  status: WorkspaceInventorySourceStatus;
  baseUrl: string;
  credentialsRef?: string;
  pollIntervalMinutes?: number;
  createdAt: string;
}

export interface WorkspaceState {
  parentAccount: WorkspaceParentAccount | null;
  dealerships: WorkspaceDealership[];
  childAccounts: WorkspaceChildAccount[];
  facebookConnections: WorkspaceFacebookConnection[];
  inventorySources: WorkspaceInventorySource[];
}

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  parentAccount: null,
  dealerships: [],
  childAccounts: [],
  facebookConnections: [],
  inventorySources: [],
};
