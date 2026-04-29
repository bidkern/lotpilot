import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import nodemailer from "nodemailer";

import { getAppBaseUrl } from "@/lib/app-url";
import { getResolvedIntegrationConfig } from "@/lib/integration-config";

const DATA_DIRECTORY = path.join(process.cwd(), "runtime-data");
const OUTBOX_FILE = path.join(DATA_DIRECTORY, "email-outbox.json");

export type RegistrationEmailMode = "SMTP" | "LOCAL_OUTBOX";

interface OutboxMessage {
  id: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  createdAt: string;
  mode: RegistrationEmailMode;
}

function buildRegistrationEmail(input: {
  parentAccountName: string;
  billingEmail: string;
}) {
  const appBaseUrl = getAppBaseUrl();

  return {
    to: input.billingEmail,
    subject: `Registration complete for ${input.parentAccountName} in The Book`,
    text: [
      `Your registration for ${input.parentAccountName} is complete.`,
      "",
      "You can continue setup in The Book here:",
      appBaseUrl,
      "",
      "Next recommended steps:",
      "- add a dealership",
      "- add child accounts",
      "- connect Facebook Pages",
      "- add an inventory source",
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #101720;">
        <h1 style="margin-bottom: 12px;">Registration complete</h1>
        <p style="font-size: 16px; line-height: 1.6;">
          Your registration for <strong>${input.parentAccountName}</strong> is complete.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">
          Continue setup in <strong>The Book</strong>:
          <a href="${appBaseUrl}" style="color: #477754;">${appBaseUrl}</a>
        </p>
        <p style="font-size: 16px; line-height: 1.6;">Next recommended steps:</p>
        <ul style="font-size: 16px; line-height: 1.8; padding-left: 20px;">
          <li>Add a dealership</li>
          <li>Add child accounts</li>
          <li>Connect Facebook Pages</li>
          <li>Add an inventory source</li>
        </ul>
      </div>
    `,
  };
}

function readOutbox() {
  mkdirSync(DATA_DIRECTORY, { recursive: true });

  if (!existsSync(OUTBOX_FILE)) {
    return [] as OutboxMessage[];
  }

  try {
    return JSON.parse(readFileSync(OUTBOX_FILE, "utf8")) as OutboxMessage[];
  } catch {
    return [];
  }
}

function appendOutboxMessage(message: Omit<OutboxMessage, "id" | "createdAt">) {
  const outbox = readOutbox();
  const nextMessage: OutboxMessage = {
    ...message,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };

  writeFileSync(
    OUTBOX_FILE,
    JSON.stringify([nextMessage, ...outbox].slice(0, 20), null, 2),
    "utf8",
  );

  return nextMessage;
}

export function getRecentOutboxMessages() {
  return readOutbox();
}

export function getEmailMissingRequirements() {
  const config = getResolvedIntegrationConfig();
  const missingRequirements: string[] = [];

  if (!config.smtpHost) {
    missingRequirements.push("SMTP_HOST");
  }

  if (!config.smtpUser) {
    missingRequirements.push("SMTP_USER");
  }

  if (!config.smtpPassword) {
    missingRequirements.push("SMTP_PASSWORD");
  }

  if (!config.smtpFrom) {
    missingRequirements.push("SMTP_FROM");
  }

  return missingRequirements;
}

export function emailConfigured() {
  return true;
}

export function getEmailDeliveryMode(): RegistrationEmailMode {
  return getEmailMissingRequirements().length === 0 ? "SMTP" : "LOCAL_OUTBOX";
}

function createTransport() {
  const config = getResolvedIntegrationConfig();
  const port = Number.parseInt(config.smtpPort || "587", 10);
  const secure = config.smtpSecure === "true" || port === 465;

  return nodemailer.createTransport({
    host: config.smtpHost,
    port,
    secure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword,
    },
  });
}

export async function sendRegistrationCompleteEmail(input: {
  parentAccountName: string;
  billingEmail: string;
}) {
  const config = getResolvedIntegrationConfig();
  const message = buildRegistrationEmail(input);
  const mode = getEmailDeliveryMode();

  if (mode === "SMTP") {
    await createTransport().sendMail({
      from: config.smtpFrom,
      ...message,
    });

    return {
      mode,
      sentAt: new Date().toISOString(),
    };
  }

  appendOutboxMessage({
    from: config.smtpFrom || "local-outbox@the-book.local",
    mode,
    ...message,
  });

  return {
    mode,
    sentAt: new Date().toISOString(),
  };
}
