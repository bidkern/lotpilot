import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { getResolvedIntegrationConfig } from "@/lib/integration-config";

function getEncryptionKeyMaterial() {
  const rawValue = getResolvedIntegrationConfig().encryptionKey;

  if (!rawValue) {
    return null;
  }

  return createHash("sha256").update(rawValue).digest();
}

export function encryptionConfigured() {
  return Boolean(getEncryptionKeyMaterial());
}

export function encryptSecret(value: string) {
  const key = getEncryptionKeyMaterial();

  if (!key) {
    throw new Error("ENCRYPTION_KEY is missing. Set it before storing OAuth tokens.");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSecret(payload: string) {
  const key = getEncryptionKeyMaterial();

  if (!key) {
    throw new Error("ENCRYPTION_KEY is missing. Set it before reading OAuth tokens.");
  }

  const [ivValue, tagValue, encryptedValue] = payload.split(".");

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted secret payload is malformed.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivValue, "base64url"),
  );

  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
