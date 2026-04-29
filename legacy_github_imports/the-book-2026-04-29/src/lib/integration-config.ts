import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const DATA_DIRECTORY = path.join(process.cwd(), "runtime-data");
const CONFIG_FILE = path.join(DATA_DIRECTORY, "integration-config.json");
const PLACEHOLDER = "replace-me";

export interface LocalIntegrationConfig {
  facebookAppId?: string;
  facebookAppSecret?: string;
  encryptionKey?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpSecure?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  updatedAt?: string;
}

function normalizeValue(value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized || normalized === PLACEHOLDER) {
    return undefined;
  }

  return normalized;
}

function ensureConfigFile() {
  mkdirSync(DATA_DIRECTORY, { recursive: true });

  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify({ updatedAt: new Date().toISOString() }, null, 2));
  }
}

export function getLocalIntegrationConfig() {
  ensureConfigFile();

  try {
    const rawValue = readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(rawValue) as LocalIntegrationConfig;
  } catch {
    return {};
  }
}

export function getResolvedIntegrationConfig() {
  const localConfig = getLocalIntegrationConfig();

  return {
    facebookAppId:
      normalizeValue(process.env.FACEBOOK_APP_ID) ??
      normalizeValue(localConfig.facebookAppId),
    facebookAppSecret:
      normalizeValue(process.env.FACEBOOK_APP_SECRET) ??
      normalizeValue(localConfig.facebookAppSecret),
    encryptionKey:
      normalizeValue(process.env.ENCRYPTION_KEY) ??
      normalizeValue(localConfig.encryptionKey),
    smtpHost:
      normalizeValue(process.env.SMTP_HOST) ??
      normalizeValue(localConfig.smtpHost),
    smtpPort: process.env.SMTP_PORT?.trim() || localConfig.smtpPort || "587",
    smtpSecure: process.env.SMTP_SECURE?.trim() || localConfig.smtpSecure || "false",
    smtpUser:
      normalizeValue(process.env.SMTP_USER) ??
      normalizeValue(localConfig.smtpUser),
    smtpPassword:
      normalizeValue(process.env.SMTP_PASSWORD) ??
      normalizeValue(localConfig.smtpPassword),
    smtpFrom:
      normalizeValue(process.env.SMTP_FROM) ??
      normalizeValue(localConfig.smtpFrom),
  };
}

export function saveLocalIntegrationConfig(input: {
  facebookAppId?: string;
  facebookAppSecret?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpSecure?: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  generateEncryptionKey?: boolean;
}) {
  const currentConfig = getLocalIntegrationConfig();

  const nextConfig: LocalIntegrationConfig = {
    ...currentConfig,
    facebookAppId:
      input.facebookAppId !== undefined
        ? input.facebookAppId.trim()
        : currentConfig.facebookAppId,
    facebookAppSecret:
      input.facebookAppSecret !== undefined
        ? input.facebookAppSecret.trim()
        : currentConfig.facebookAppSecret,
    smtpHost:
      input.smtpHost !== undefined ? input.smtpHost.trim() : currentConfig.smtpHost,
    smtpPort:
      input.smtpPort !== undefined ? input.smtpPort.trim() : currentConfig.smtpPort,
    smtpSecure:
      input.smtpSecure !== undefined
        ? input.smtpSecure.trim()
        : currentConfig.smtpSecure,
    smtpUser:
      input.smtpUser !== undefined ? input.smtpUser.trim() : currentConfig.smtpUser,
    smtpPassword:
      input.smtpPassword !== undefined
        ? input.smtpPassword.trim()
        : currentConfig.smtpPassword,
    smtpFrom:
      input.smtpFrom !== undefined ? input.smtpFrom.trim() : currentConfig.smtpFrom,
    encryptionKey: currentConfig.encryptionKey,
    updatedAt: new Date().toISOString(),
  };

  if (
    input.generateEncryptionKey &&
    !normalizeValue(currentConfig.encryptionKey) &&
    (normalizeValue(nextConfig.facebookAppId) || normalizeValue(nextConfig.facebookAppSecret))
  ) {
    nextConfig.encryptionKey = randomBytes(32).toString("base64url");
  }

  ensureConfigFile();
  writeFileSync(CONFIG_FILE, JSON.stringify(nextConfig, null, 2), "utf8");

  return nextConfig;
}
