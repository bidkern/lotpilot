import { IdempotencyStatus, Prisma } from "@prisma/client";
import { createHash } from "crypto";

import { prisma } from "@/lib/prisma";

type ReserveIdempotencyKeyInput = {
  expiresInSeconds?: number;
  key: string;
  payload?: unknown;
  scope: string;
  tenantId?: string | null;
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function buildPayloadFingerprint(payload: unknown) {
  if (payload === undefined) {
    return null;
  }

  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function reserveIdempotencyKey(input: ReserveIdempotencyKeyInput) {
  const fingerprint = buildPayloadFingerprint(input.payload);
  try {
    const record = await prisma.idempotencyKey.create({
      data: {
        expiresAt: input.expiresInSeconds
          ? new Date(Date.now() + input.expiresInSeconds * 1000)
          : undefined,
        fingerprint: fingerprint ?? undefined,
        key: input.key,
        scope: input.scope,
        tenantId: input.tenantId ?? undefined,
      },
    });

    return {
      isNew: true,
      record,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const record = await prisma.idempotencyKey.findFirstOrThrow({
      where: {
        key: input.key,
        scope: input.scope,
        tenantId: input.tenantId ?? null,
      },
    });

    if (record.fingerprint && fingerprint && record.fingerprint !== fingerprint) {
      throw new Error("An idempotent operation with the same key already exists for different input.");
    }

    return {
      isNew: false,
      record,
    };
  }
}

export async function completeIdempotencyKey(input: {
  idempotencyKeyId: string;
  resourceId?: string | null;
  resourceType?: string | null;
  responsePayload?: unknown;
}) {
  return prisma.idempotencyKey.update({
    where: {
      id: input.idempotencyKeyId,
    },
    data: {
      resourceId: input.resourceId ?? undefined,
      resourceType: input.resourceType ?? undefined,
      responsePayload: input.responsePayload as Prisma.InputJsonValue | undefined,
      status: IdempotencyStatus.COMPLETED,
    },
  });
}

export async function failIdempotencyKey(input: {
  idempotencyKeyId: string;
  responsePayload?: unknown;
}) {
  return prisma.idempotencyKey.update({
    where: {
      id: input.idempotencyKeyId,
    },
    data: {
      responsePayload: input.responsePayload as Prisma.InputJsonValue | undefined,
      status: IdempotencyStatus.FAILED,
    },
  });
}

export function buildIdempotencyKey(parts: Array<string | number | null | undefined>) {
  return parts
    .filter((value): value is string | number => value !== null && value !== undefined)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(":");
}

export function hashSelectionFingerprint(payload: unknown) {
  return buildPayloadFingerprint(payload) ?? "empty";
}
