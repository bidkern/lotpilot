import type {
  WorkspaceChildAccount,
  WorkspaceFacebookConnection,
  WorkspaceInventorySource,
  WorkspaceState,
} from "@/lib/workspace-types";

export function getChildDisplayName(childAccount: WorkspaceChildAccount) {
  return `${childAccount.firstName} ${childAccount.lastName}`.trim();
}

export function getFacebookConnectionByChildId(
  workspace: WorkspaceState,
  childAccountId: string,
) {
  return workspace.facebookConnections.find(
    (connection) => connection.childAccountId === childAccountId,
  );
}

export function getInventorySourcesByDealershipId(workspace: WorkspaceState) {
  return workspace.inventorySources.reduce<Record<string, WorkspaceInventorySource[]>>(
    (grouped, source) => {
      const current = grouped[source.dealershipId] ?? [];
      current.push(source);
      grouped[source.dealershipId] = current;
      return grouped;
    },
    {},
  );
}

export function getDealershipNameById(workspace: WorkspaceState) {
  return Object.fromEntries(
    workspace.dealerships.map((dealership) => [dealership.id, dealership.name]),
  );
}

export function getFacebookStatusTone(
  connection: WorkspaceFacebookConnection | undefined,
) {
  if (!connection) {
    return "slate" as const;
  }

  if (connection.status === "CONNECTED") {
    return "forest" as const;
  }

  if (connection.status === "PENDING") {
    return "tan" as const;
  }

  if (connection.status === "DISCONNECTED") {
    return "tan" as const;
  }

  return "slate" as const;
}

export function getWorkspaceSummary(workspace: WorkspaceState) {
  const dealershipCount = workspace.dealerships.length;
  const childCount = workspace.childAccounts.length;
  const facebookCount = workspace.facebookConnections.length;
  const connectedFacebookCount = workspace.facebookConnections.filter(
    (connection) => connection.status === "CONNECTED",
  ).length;
  const inventorySourceCount = workspace.inventorySources.length;

  const checklist = [
    {
      id: "parent",
      label: "Create a parent account",
      complete: Boolean(workspace.parentAccount),
    },
    {
      id: "dealership",
      label: "Add at least one dealership",
      complete: dealershipCount > 0,
    },
    {
      id: "child",
      label: "Create child accounts",
      complete: childCount > 0,
    },
    {
      id: "facebook",
      label: "Attach or connect Facebook",
      complete: connectedFacebookCount > 0,
    },
    {
      id: "inventorySource",
      label: "Add an inventory source",
      complete: inventorySourceCount > 0,
    },
  ] as const;

  const completedSteps = checklist.filter((step) => step.complete).length;

  return {
    checklist,
    completedSteps,
    completionPercent: Math.round((completedSteps / checklist.length) * 100),
    connectedFacebookCount,
    childCount,
    dealershipCount,
    facebookCount,
    inventorySourceCount,
    parentConfigured: Boolean(workspace.parentAccount),
  };
}
