"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  Facebook,
  Link2,
  Plus,
  RefreshCcw,
  ServerCog,
  Trash2,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { PageHeader } from "@/components/ui/page-header";
import {
  getChildDisplayName,
  getDealershipNameById,
  getFacebookConnectionByChildId,
  getFacebookStatusTone,
  getInventorySourcesByDealershipId,
  getWorkspaceSummary,
} from "@/lib/workspace-derived";
import {
  addChildAccount,
  addDealership,
  addInventorySource,
  attachFacebookConnection,
  createParentAccount,
  getFacebookOauthStartPath,
  resetWorkspace,
  selectFacebookPage,
  useWorkspace,
} from "@/lib/workspace-store";
import type { WorkspaceFacebookConnection } from "@/lib/workspace-types";

const inputClassName =
  "w-full rounded-2xl border border-[var(--border)] bg-[var(--card-soft)] px-4 py-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-not-allowed disabled:opacity-60";
const buttonClassName =
  "inline-flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-foreground)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

type FeedbackTone = "forest" | "tan";

interface FeedbackState {
  tone: FeedbackTone;
  text: string;
}

interface IntegrationStatus {
  facebook: {
    configured: boolean;
    missingRequirements: string[];
    callbackUrl: string;
    scopes: string[];
  };
  email: {
    configured: boolean;
    mode: "SMTP" | "LOCAL_OUTBOX";
    missingRequirements: string[];
    fromAddress: string | null;
    outboxUrl: string;
  };
}

export function WorkspaceLab() {
  const workspace = useWorkspace();
  const summary = getWorkspaceSummary(workspace);
  const searchParams = useSearchParams();
  const dealershipNameById = getDealershipNameById(workspace);
  const inventorySourcesByDealershipId = getInventorySourcesByDealershipId(workspace);
  const facebookSearchStatus = searchParams.get("facebook");
  const facebookSearchMessage = searchParams.get("message");
  const highlightedConnectionId = searchParams.get("connectionId");

  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(
    null,
  );
  const [facebookAppId, setFacebookAppId] = useState("");
  const [facebookAppSecret, setFacebookAppSecret] = useState("");

  const [parentName, setParentName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [dealershipName, setDealershipName] = useState("");
  const [dealershipCity, setDealershipCity] = useState("");
  const [dealershipState, setDealershipState] = useState("");
  const [dealershipTimezone, setDealershipTimezone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [childDealershipId, setChildDealershipId] = useState("");
  const [role, setRole] = useState<
    "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE" | "BILLING"
  >("EMPLOYEE");
  const [selectedChildAccountId, setSelectedChildAccountId] = useState("");
  const [facebookLabel, setFacebookLabel] = useState("");
  const [facebookProfileUrl, setFacebookProfileUrl] = useState("");
  const [facebookStatus, setFacebookStatus] = useState<
    "CONNECTED" | "PENDING" | "DISCONNECTED"
  >("CONNECTED");
  const [selectedPageByConnectionId, setSelectedPageByConnectionId] = useState<
    Record<string, string>
  >({});
  const [sourceDealershipId, setSourceDealershipId] = useState("");
  const [sourceType, setSourceType] = useState<
    "API" | "FEED" | "WEBHOOK" | "MANUAL"
  >("FEED");
  const [sourceProvider, setSourceProvider] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceStatus, setSourceStatus] = useState<
    "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "ERROR"
  >("CONNECTED");
  const [sourceBaseUrl, setSourceBaseUrl] = useState("");
  const [sourceCredentialsRef, setSourceCredentialsRef] = useState("");
  const [sourcePollInterval, setSourcePollInterval] = useState("15");

  async function refreshIntegrationStatus() {
    const response = await fetch("/api/setup/integrations/status", {
      cache: "no-store",
    });
    const payload = (await response.json()) as { integrations?: IntegrationStatus };

    if (payload.integrations) {
      setIntegrationStatus(payload.integrations);
    }
  }

  useEffect(() => {
    void refreshIntegrationStatus().catch(() => {
      setIntegrationStatus(null);
    });
  }, []);

  useEffect(() => {
    if (!facebookSearchStatus) {
      return;
    }

    setFeedback({
      tone: facebookSearchStatus === "connected" ? "forest" : "tan",
      text:
        facebookSearchMessage ||
        (facebookSearchStatus === "connected"
          ? "Facebook connected successfully."
          : "Facebook connection needs attention."),
    });
  }, [facebookSearchMessage, facebookSearchStatus]);

  const selectedChildAccount = useMemo(
    () =>
      workspace.childAccounts.find((account) => account.id === selectedChildAccountId),
    [selectedChildAccountId, workspace.childAccounts],
  );

  async function runAction(
    actionKey: string,
    successMessage: string,
    action: () => Promise<unknown>,
  ) {
    setActiveAction(actionKey);

    try {
      await action();
      setFeedback({ tone: "forest", text: successMessage });
    } catch (error) {
      setFeedback({
        tone: "tan",
        text:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the workspace.",
      });
    } finally {
      setActiveAction(null);
    }
  }

  async function handleCreateParentAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!parentName.trim() || !billingEmail.trim()) {
      setFeedback({
        tone: "tan",
        text: "Enter a parent account name and billing email first.",
      });
      return;
    }

    setActiveAction("parent");

    try {
      const nextWorkspace = await createParentAccount({ name: parentName, billingEmail });
      setParentName("");
      setBillingEmail("");
      setSelectedChildAccountId("");

      const emailStatus = nextWorkspace.parentAccount?.registrationEmailStatus;
      const emailMode = nextWorkspace.parentAccount?.registrationEmailDeliveryMode;
      const emailError = nextWorkspace.parentAccount?.registrationEmailLastError;

      setFeedback({
        tone: emailStatus === "FAILED" ? "tan" : "forest",
        text:
          emailStatus === "SENT"
            ? emailMode === "LOCAL_OUTBOX"
              ? "Parent account created and registration-complete email captured in the local outbox."
              : "Parent account created and registration-complete email sent."
            : emailStatus === "SKIPPED"
              ? emailError || "Parent account created. Registration email was skipped."
              : emailStatus === "FAILED"
                ? emailError || "Parent account created, but the registration email failed."
                : "Parent account created.",
      });
    } catch (error) {
      setFeedback({
        tone: "tan",
        text:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the workspace.",
      });
    } finally {
      setActiveAction(null);
    }
  }

  async function handleCreateDealership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !dealershipName.trim() ||
      !dealershipCity.trim() ||
      !dealershipState.trim() ||
      !dealershipTimezone.trim()
    ) {
      setFeedback({ tone: "tan", text: "Fill in every dealership field first." });
      return;
    }

    await runAction("dealership", "Dealership saved.", async () => {
      await addDealership({
        name: dealershipName,
        city: dealershipCity,
        state: dealershipState,
        timezone: dealershipTimezone,
      });
      setDealershipName("");
      setDealershipCity("");
      setDealershipState("");
      setDealershipTimezone("");
    });
  }

  async function handleCreateChildAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setFeedback({ tone: "tan", text: "Fill in the child account details first." });
      return;
    }

    await runAction("child", "Child account created.", async () => {
      await addChildAccount({
        dealershipId: childDealershipId || undefined,
        firstName,
        lastName,
        email,
        role,
      });
      setFirstName("");
      setLastName("");
      setEmail("");
      setChildDealershipId("");
      setRole("EMPLOYEE");
    });
  }

  async function handleAttachFacebook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedChildAccountId || !facebookLabel.trim()) {
      setFeedback({
        tone: "tan",
        text: "Pick a child account and label before saving the placeholder.",
      });
      return;
    }

    await runAction("facebook-manual", "Manual Facebook record saved.", async () => {
      await attachFacebookConnection({
        childAccountId: selectedChildAccountId,
        accountLabel: facebookLabel,
        profileUrl: facebookProfileUrl,
        status: facebookStatus,
      });
      setFacebookLabel("");
      setFacebookProfileUrl("");
      setFacebookStatus("CONNECTED");
    });
  }

  async function handleCreateInventorySource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sourceDealershipId || !sourceProvider.trim() || !sourceLabel.trim()) {
      setFeedback({
        tone: "tan",
        text: "Pick a dealership, provider, and label before creating a source.",
      });
      return;
    }

    await runAction("inventory", "Inventory source created.", async () => {
      await addInventorySource({
        dealershipId: sourceDealershipId,
        type: sourceType,
        provider: sourceProvider,
        label: sourceLabel,
        status: sourceStatus,
        baseUrl: sourceBaseUrl,
        credentialsRef: sourceCredentialsRef || undefined,
        pollIntervalMinutes:
          sourceType === "WEBHOOK"
            ? undefined
            : Number.parseInt(sourcePollInterval, 10) || undefined,
      });
      setSourceDealershipId("");
      setSourceType("FEED");
      setSourceProvider("");
      setSourceLabel("");
      setSourceStatus("CONNECTED");
      setSourceBaseUrl("");
      setSourceCredentialsRef("");
      setSourcePollInterval("15");
    });
  }

  async function handleResetWorkspace() {
    await runAction("reset", "Workspace reset.", async () => {
      await resetWorkspace();
      setSelectedChildAccountId("");
      setSelectedPageByConnectionId({});
    });
  }

  function handleStartFacebookOauth() {
    if (!selectedChildAccountId) {
      setFeedback({
        tone: "tan",
        text: "Choose a child account before starting Facebook Login.",
      });
      return;
    }

    window.location.assign(getFacebookOauthStartPath(selectedChildAccountId));
  }

  async function handleSaveFacebookCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!facebookAppId.trim() || !facebookAppSecret.trim()) {
      setFeedback({
        tone: "tan",
        text: "Enter both the Facebook App ID and App Secret first.",
      });
      return;
    }

    await runAction("facebook-config", "Facebook app credentials saved.", async () => {
      const response = await fetch("/api/setup/integrations/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          facebookAppId,
          facebookAppSecret,
          generateEncryptionKey: true,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(payload?.error || "Unable to save Facebook app credentials.");
      }

      setFacebookAppSecret("");
      await refreshIntegrationStatus();
    });
  }

  async function handleSelectFacebookPage(connection: WorkspaceFacebookConnection) {
    const pageId =
      selectedPageByConnectionId[connection.id] || connection.selectedPageId;

    if (!pageId) {
      setFeedback({ tone: "tan", text: "Choose a Facebook Page first." });
      return;
    }

    await runAction("facebook-page", "Facebook Page selected.", async () => {
      await selectFacebookPage({ connectionId: connection.id, pageId });
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <button
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={activeAction === "reset"}
            onClick={handleResetWorkspace}
            type="button"
          >
            <Trash2 size={16} />
            Reset test workspace
          </button>
        }
        description="Start with a blank server-backed test workspace. Create your own parent account, add a dealership, make child accounts, connect Facebook with the official Page login path, and register inventory sources without guessed company data."
        eyebrow="Test setup"
        title="Setup workspace"
      />

      {feedback ? (
        <div className="rounded-[28px] border border-[var(--border)] bg-[var(--card)] p-4">
          <Badge tone={feedback.tone}>
            {feedback.tone === "forest" ? "Saved" : "Attention"}
          </Badge>
          <p className="mt-3 text-sm leading-7 text-[var(--foreground)]">
            {feedback.text}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Parent account">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em]">
            {workspace.parentAccount ? "1" : "0"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {workspace.parentAccount?.name || "No parent account created yet."}
          </p>
        </Panel>
        <Panel title="Dealerships">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em]">
            {workspace.dealerships.length}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Dealerships configured under the current parent account.
          </p>
        </Panel>
        <Panel title="Child accounts">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em]">
            {workspace.childAccounts.length}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Accounts created under the current parent account.
          </p>
        </Panel>
        <Panel title="Connected Facebooks">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em]">
            {summary.connectedFacebookCount}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Connections with a selected Page.
          </p>
        </Panel>
        <Panel title="Inventory sources">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em]">
            {summary.inventorySourceCount}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Persisted source records.
          </p>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel
          action={
            <Badge tone={workspace.parentAccount ? "forest" : "slate"}>
              {workspace.parentAccount ? "Configured" : "Required first"}
            </Badge>
          }
          description="Create the tenant root first. A registration-complete email will be sent to the billing email when SMTP is configured."
          title="Create parent account"
        >
          {workspace.parentAccount ? (
            <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
              <p className="font-semibold text-[var(--foreground)]">
                {workspace.parentAccount.name}
              </p>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Billing email: {workspace.parentAccount.billingEmail}
              </p>
              {workspace.parentAccount.registrationEmailStatus ? (
                <div className="mt-4 space-y-2">
                  <Badge
                    tone={
                      workspace.parentAccount.registrationEmailStatus === "SENT"
                        ? "forest"
                        : "tan"
                    }
                  >
                    Registration email {workspace.parentAccount.registrationEmailStatus.toLowerCase()}
                  </Badge>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {workspace.parentAccount.registrationEmailStatus === "SENT"
                      ? `${
                          workspace.parentAccount.registrationEmailDeliveryMode ===
                          "LOCAL_OUTBOX"
                            ? "Captured in the local outbox"
                            : `Sent to ${workspace.parentAccount.billingEmail}`
                        }${
                          workspace.parentAccount.registrationEmailSentAt
                            ? ` on ${new Intl.DateTimeFormat("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              }).format(
                                new Date(
                                  workspace.parentAccount.registrationEmailSentAt,
                                ),
                              )}`
                            : ""
                        }.`
                      : workspace.parentAccount.registrationEmailLastError ||
                        "Registration email was not sent."}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleCreateParentAccount}>
              <input
                className={inputClassName}
                onChange={(event) => setParentName(event.target.value)}
                placeholder="Parent account name"
                value={parentName}
              />
              <input
                className={inputClassName}
                onChange={(event) => setBillingEmail(event.target.value)}
                placeholder="Billing email"
                type="email"
                value={billingEmail}
              />
              <button
                className={buttonClassName}
                disabled={activeAction === "parent"}
                type="submit"
              >
                <Plus size={16} />
                Create parent account
              </button>
              <div className="rounded-[20px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
                <p className="font-semibold text-[var(--foreground)]">
                  Registration email
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
                  {integrationStatus?.email.mode === "SMTP"
                    ? `SMTP is ready${integrationStatus.email.fromAddress ? ` from ${integrationStatus.email.fromAddress}` : ""}.`
                    : "Local outbox mode is active, so registration email previews are captured on this machine even without SMTP."}
                </p>
                {integrationStatus?.email.mode === "LOCAL_OUTBOX" ? (
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                    Preview inbox:{" "}
                    <span className="font-mono text-xs text-[var(--foreground)]">
                      {integrationStatus.email.outboxUrl}
                    </span>
                  </p>
                ) : null}
                {integrationStatus?.email.mode === "SMTP" &&
                integrationStatus.email.missingRequirements.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {integrationStatus.email.missingRequirements.map((item) => (
                      <Badge key={item} tone="tan">
                        Missing {item}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </form>
          )}
        </Panel>

        <Panel
          action={
            <Badge tone={workspace.parentAccount ? "forest" : "tan"}>
              {workspace.parentAccount ? "Next step" : "Locked"}
            </Badge>
          }
          description="Create the dealership record next."
          title="Add dealership"
        >
          <form className="space-y-4" onSubmit={handleCreateDealership}>
            <input
              className={inputClassName}
              disabled={!workspace.parentAccount || activeAction === "dealership"}
              onChange={(event) => setDealershipName(event.target.value)}
              placeholder="Dealership name"
              value={dealershipName}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                className={inputClassName}
                disabled={!workspace.parentAccount || activeAction === "dealership"}
                onChange={(event) => setDealershipCity(event.target.value)}
                placeholder="City"
                value={dealershipCity}
              />
              <input
                className={inputClassName}
                disabled={!workspace.parentAccount || activeAction === "dealership"}
                onChange={(event) => setDealershipState(event.target.value)}
                placeholder="State"
                value={dealershipState}
              />
            </div>
            <input
              className={inputClassName}
              disabled={!workspace.parentAccount || activeAction === "dealership"}
              onChange={(event) => setDealershipTimezone(event.target.value)}
              placeholder="Timezone"
              value={dealershipTimezone}
            />
            <button
              className={buttonClassName}
              disabled={!workspace.parentAccount || activeAction === "dealership"}
              type="submit"
            >
              <Building2 size={16} />
              Add dealership
            </button>
          </form>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel
          action={
            <Badge tone={workspace.parentAccount ? "forest" : "tan"}>
              {workspace.parentAccount ? "Open" : "Locked"}
            </Badge>
          }
          description="Use this for owners, admins, managers, employees, or billing contacts."
          title="Create child accounts"
        >
          <form className="space-y-4" onSubmit={handleCreateChildAccount}>
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                className={inputClassName}
                disabled={!workspace.parentAccount || activeAction === "child"}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="First name"
                value={firstName}
              />
              <input
                className={inputClassName}
                disabled={!workspace.parentAccount || activeAction === "child"}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="Last name"
                value={lastName}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <input
                className={inputClassName}
                disabled={!workspace.parentAccount || activeAction === "child"}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                type="email"
                value={email}
              />
              <select
                className={inputClassName}
                disabled={!workspace.parentAccount || activeAction === "child"}
                onChange={(event) => setRole(event.target.value as typeof role)}
                value={role}
              >
                <option value="EMPLOYEE">Employee</option>
                <option value="MANAGER">Manager</option>
                <option value="ADMIN">Admin</option>
                <option value="OWNER">Owner</option>
                <option value="BILLING">Billing</option>
              </select>
            </div>
            <select
              className={inputClassName}
              disabled={!workspace.parentAccount || activeAction === "child"}
              onChange={(event) => setChildDealershipId(event.target.value)}
              value={childDealershipId}
            >
              <option value="">Parent-level only</option>
              {workspace.dealerships.map((dealership) => (
                <option key={dealership.id} value={dealership.id}>
                  {dealership.name}
                </option>
              ))}
            </select>
            <button
              className={buttonClassName}
              disabled={!workspace.parentAccount || activeAction === "child"}
              type="submit"
            >
              <Users size={16} />
              Add child account
            </button>
          </form>
        </Panel>

        <Panel
          action={<Badge tone="navy">Official Page path</Badge>}
          description="Use Facebook Login to verify the child account and return managed Pages. Marketplace stays human-assisted."
          title="Connect Facebook"
        >
          <div className="space-y-4">
            <select
              className={inputClassName}
              disabled={workspace.childAccounts.length === 0}
              onChange={(event) => setSelectedChildAccountId(event.target.value)}
              value={selectedChildAccountId}
            >
              <option value="">Select child account</option>
              {workspace.childAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {getChildDisplayName(account)}
                </option>
              ))}
            </select>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
                <p className="font-semibold text-[var(--foreground)]">
                  {selectedChildAccount
                    ? `Official connect for ${getChildDisplayName(selectedChildAccount)}`
                    : "Choose a child account to start Facebook Login"}
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--muted-foreground)]">
                  Requested scopes:{" "}
                  {integrationStatus?.facebook.scopes.join(", ") ||
                    "pages_show_list, pages_manage_metadata, pages_messaging"}
                </p>
              </div>
              <button
                className={buttonClassName}
                disabled={
                  !selectedChildAccountId ||
                  !integrationStatus?.facebook.configured
                }
                onClick={handleStartFacebookOauth}
                type="button"
              >
                <Facebook size={16} />
                {integrationStatus?.facebook.configured
                  ? "Connect with Facebook"
                  : "Facebook setup required"}
              </button>
            </div>
            <div className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4">
              <div className="flex items-start gap-3">
                <ServerCog className="mt-0.5 text-[var(--accent)]" size={18} />
                <div className="space-y-3 text-sm leading-7 text-[var(--muted-foreground)]">
                  <p>
                    {integrationStatus?.facebook.configured
                      ? "Facebook OAuth is configured. Make sure this callback URL is registered in your Meta app."
                      : "Facebook OAuth is not ready yet. Add the missing env values below, restart the dev server, then try again."}
                  </p>
                  <p>
                    Callback URL:{" "}
                    <span className="font-mono text-xs text-[var(--foreground)]">
                      {integrationStatus?.facebook.callbackUrl ||
                        "http://localhost:3000/api/setup/facebook/oauth/callback"}
                    </span>
                  </p>
                  {integrationStatus?.facebook.missingRequirements.length ? (
                    <div className="flex flex-wrap gap-2">
                      {integrationStatus.facebook.missingRequirements.map((item) => (
                        <Badge key={item} tone="tan">
                          Missing {item}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <form className="space-y-4" onSubmit={handleSaveFacebookCredentials}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-[var(--foreground)]">
                  Meta app credentials
                </p>
                <Badge
                  tone={integrationStatus?.facebook.configured ? "forest" : "tan"}
                >
                  {integrationStatus?.facebook.configured ? "Saved" : "Needed"}
                </Badge>
              </div>
              <input
                className={inputClassName}
                onChange={(event) => setFacebookAppId(event.target.value)}
                placeholder="Facebook App ID"
                value={facebookAppId}
              />
              <input
                className={inputClassName}
                onChange={(event) => setFacebookAppSecret(event.target.value)}
                placeholder="Facebook App Secret"
                type="password"
                value={facebookAppSecret}
              />
              <button
                className={buttonClassName}
                disabled={activeAction === "facebook-config"}
                type="submit"
              >
                <ServerCog size={16} />
                Save Meta app credentials
              </button>
            </form>
            <form className="space-y-4" onSubmit={handleAttachFacebook}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-[var(--foreground)]">
                  Manual placeholder
                </p>
                <Badge tone="tan">Fallback only</Badge>
              </div>
              <input
                className={inputClassName}
                disabled={workspace.childAccounts.length === 0}
                onChange={(event) => setFacebookLabel(event.target.value)}
                placeholder="Facebook account label"
                value={facebookLabel}
              />
              <input
                className={inputClassName}
                disabled={workspace.childAccounts.length === 0}
                onChange={(event) => setFacebookProfileUrl(event.target.value)}
                placeholder="Facebook profile URL"
                value={facebookProfileUrl}
              />
              <select
                className={inputClassName}
                disabled={workspace.childAccounts.length === 0}
                onChange={(event) =>
                  setFacebookStatus(event.target.value as typeof facebookStatus)
                }
                value={facebookStatus}
              >
                <option value="CONNECTED">Connected</option>
                <option value="PENDING">Pending</option>
                <option value="DISCONNECTED">Disconnected</option>
              </select>
              <button
                className={buttonClassName}
                disabled={
                  workspace.childAccounts.length === 0 ||
                  activeAction === "facebook-manual"
                }
                type="submit"
              >
                <RefreshCcw size={16} />
                Save manual placeholder
              </button>
            </form>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel
          action={<Badge tone="forest">Next integration</Badge>}
          description="Define how vehicles will enter the platform before normalization and rotation."
          title="Add inventory source"
        >
          <form className="space-y-4" onSubmit={handleCreateInventorySource}>
            <select
              className={inputClassName}
              disabled={workspace.dealerships.length === 0}
              onChange={(event) => setSourceDealershipId(event.target.value)}
              value={sourceDealershipId}
            >
              <option value="">Select dealership</option>
              {workspace.dealerships.map((dealership) => (
                <option key={dealership.id} value={dealership.id}>
                  {dealership.name}
                </option>
              ))}
            </select>
            <div className="grid gap-4 sm:grid-cols-2">
              <select
                className={inputClassName}
                disabled={workspace.dealerships.length === 0}
                onChange={(event) => setSourceType(event.target.value as typeof sourceType)}
                value={sourceType}
              >
                <option value="FEED">Feed</option>
                <option value="API">API</option>
                <option value="WEBHOOK">Webhook</option>
                <option value="MANUAL">Manual import</option>
              </select>
              <select
                className={inputClassName}
                disabled={workspace.dealerships.length === 0}
                onChange={(event) =>
                  setSourceStatus(event.target.value as typeof sourceStatus)
                }
                value={sourceStatus}
              >
                <option value="CONNECTED">Connected</option>
                <option value="DEGRADED">Degraded</option>
                <option value="DISCONNECTED">Disconnected</option>
                <option value="ERROR">Error</option>
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                className={inputClassName}
                disabled={workspace.dealerships.length === 0}
                onChange={(event) => setSourceProvider(event.target.value)}
                placeholder="Provider name"
                value={sourceProvider}
              />
              <input
                className={inputClassName}
                disabled={workspace.dealerships.length === 0}
                onChange={(event) => setSourceLabel(event.target.value)}
                placeholder="Source label"
                value={sourceLabel}
              />
            </div>
            <input
              className={inputClassName}
              disabled={workspace.dealerships.length === 0}
              onChange={(event) => setSourceBaseUrl(event.target.value)}
              placeholder="Base URL or feed endpoint"
              value={sourceBaseUrl}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                className={inputClassName}
                disabled={workspace.dealerships.length === 0}
                onChange={(event) => setSourceCredentialsRef(event.target.value)}
                placeholder="Credential reference"
                value={sourceCredentialsRef}
              />
              <input
                className={inputClassName}
                disabled={workspace.dealerships.length === 0 || sourceType === "WEBHOOK"}
                onChange={(event) => setSourcePollInterval(event.target.value)}
                placeholder="Poll interval minutes"
                value={sourcePollInterval}
              />
            </div>
            <button
              className={buttonClassName}
              disabled={workspace.dealerships.length === 0 || activeAction === "inventory"}
              type="submit"
            >
              <Plus size={16} />
              Add inventory source
            </button>
          </form>
        </Panel>

        <Panel
          action={<Badge tone="navy">{workspace.inventorySources.length} records</Badge>}
          description="These source definitions are now persisted on the server."
          title="Inventory source list"
        >
          {workspace.inventorySources.length === 0 ? (
            <p className="text-sm leading-7 text-[var(--muted-foreground)]">
              No inventory sources yet. Add one per dealership to define how
              vehicles should flow into The Book.
            </p>
          ) : (
            <div className="space-y-3">
              {workspace.dealerships.map((dealership) => {
                const sources = inventorySourcesByDealershipId[dealership.id] ?? [];

                if (sources.length === 0) {
                  return null;
                }

                return (
                  <div
                    className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                    key={dealership.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[var(--foreground)]">
                        {dealership.name}
                      </p>
                      <Badge tone="navy">{sources.length} sources</Badge>
                    </div>
                    <div className="mt-3 space-y-3">
                      {sources.map((source) => (
                        <div
                          className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-4"
                          key={source.id}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[var(--foreground)]">
                                {source.label}
                              </p>
                              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                                {source.provider}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge tone="navy">{source.type}</Badge>
                              <Badge
                                tone={
                                  source.status === "CONNECTED"
                                    ? "forest"
                                    : source.status === "DEGRADED"
                                      ? "tan"
                                      : "slate"
                                }
                              >
                                {source.status}
                              </Badge>
                            </div>
                          </div>
                          <div className="mt-3 text-sm text-[var(--muted-foreground)]">
                            <p>Endpoint: {source.baseUrl || "No endpoint saved."}</p>
                            <p>
                              Polling:{" "}
                              {source.pollIntervalMinutes
                                ? `${source.pollIntervalMinutes} minutes`
                                : source.type === "WEBHOOK"
                                  ? "Webhook-driven"
                                  : "Not set"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel
          action={<Badge tone="navy">{workspace.childAccounts.length} records</Badge>}
          description="These accounts and connection states are now persisted on the server."
          title="Child account list"
        >
          {workspace.childAccounts.length === 0 ? (
            <p className="text-sm leading-7 text-[var(--muted-foreground)]">
              No child accounts yet. Create a parent account, add a dealership if
              needed, then add accounts here.
            </p>
          ) : (
            <div className="space-y-3">
              {workspace.childAccounts.map((account) => {
                const connection = getFacebookConnectionByChildId(workspace, account.id);

                return (
                  <div
                    className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                    key={account.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">
                          {getChildDisplayName(account)}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {account.email}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge tone="navy">{account.role}</Badge>
                        <Badge tone="slate">
                          {account.dealershipId
                            ? dealershipNameById[account.dealershipId] || "Dealership"
                            : "Parent-level"}
                        </Badge>
                        <Badge tone={getFacebookStatusTone(connection)}>
                          {connection ? connection.status : "No Facebook"}
                        </Badge>
                      </div>
                    </div>
                    {connection ? (
                      <div
                        className={`mt-4 rounded-[20px] border bg-[var(--card)] p-4 ${
                          highlightedConnectionId === connection.id
                            ? "border-[var(--accent)]"
                            : "border-[var(--border)]"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-[var(--foreground)]">
                              {connection.accountLabel}
                            </p>
                            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                              {connection.connectionMode === "OAUTH"
                                ? "Verified through Facebook Login"
                                : "Manual placeholder record"}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge
                              tone={
                                connection.connectionMode === "OAUTH"
                                  ? "forest"
                                  : "tan"
                              }
                            >
                              {connection.connectionMode}
                            </Badge>
                            {connection.selectedPageName ? (
                              <Badge tone="forest">
                                Page: {connection.selectedPageName}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 text-sm text-[var(--muted-foreground)]">
                          <p>
                            Profile URL: {connection.profileUrl || "No profile URL saved."}
                          </p>
                          <p>
                            Granted scopes:{" "}
                            {connection.grantedScopes.length > 0
                              ? connection.grantedScopes.join(", ")
                              : "No scopes recorded yet"}
                          </p>
                        </div>
                        {connection.lastError ? (
                          <div className="mt-3 rounded-[18px] border border-[var(--border)] bg-[var(--card-soft)] p-3 text-sm leading-7 text-[var(--muted-foreground)]">
                            {connection.lastError}
                          </div>
                        ) : null}
                        {connection.availablePages.length > 0 ? (
                          <div className="mt-4 space-y-3">
                            <p className="font-semibold text-[var(--foreground)]">
                              Managed Pages
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {connection.availablePages.map((page) => (
                                <Badge key={page.id} tone={page.selected ? "forest" : "slate"}>
                                  {page.name}
                                </Badge>
                              ))}
                            </div>
                            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                              <select
                                className={inputClassName}
                                onChange={(event) =>
                                  setSelectedPageByConnectionId((currentState) => ({
                                    ...currentState,
                                    [connection.id]: event.target.value,
                                  }))
                                }
                                value={
                                  selectedPageByConnectionId[connection.id] ||
                                  connection.selectedPageId ||
                                  ""
                                }
                              >
                                <option value="">Select managed Page</option>
                                {connection.availablePages.map((page) => (
                                  <option key={page.id} value={page.id}>
                                    {page.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                className={buttonClassName}
                                disabled={activeAction === "facebook-page"}
                                onClick={() => void handleSelectFacebookPage(connection)}
                                type="button"
                              >
                                <Link2 size={16} />
                                Save Page
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          action={
            <Badge tone={summary.completionPercent === 100 ? "forest" : "navy"}>
              {summary.completionPercent}% complete
            </Badge>
          }
          description="This setup state now lives on the server. Nothing here is guessed from a dealership or seeded with fake names."
          title="Setup checklist"
        >
          <div className="space-y-3">
            {summary.checklist.map((step) => (
              <div
                className="rounded-[24px] border border-[var(--border)] bg-[var(--card-soft)] p-4"
                key={step.id}
              >
                <Badge tone={step.complete ? "forest" : "slate"}>
                  {step.complete ? "Done" : "Open"}
                </Badge>
                <p className="mt-3 font-semibold text-[var(--foreground)]">
                  {step.label}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
