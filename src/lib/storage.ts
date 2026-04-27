import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { StorageProvider } from "@prisma/client";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { env, isTruthyFlag } from "@/lib/env";
import { logger } from "@/lib/logger";

type PutStoredObjectInput = {
  body: Buffer | Uint8Array | string;
  contentType: string;
  key: string;
};

type ReadStoredObjectInput = {
  key?: string | null;
  provider?: StorageProvider | null;
};

type StoredObjectResult = {
  key: string;
  provider: StorageProvider;
  publicUrl: string | null;
};

const globalForStorage = globalThis as unknown as {
  s3Client?: S3Client;
};

function sanitizeStorageSegment(segment: string) {
  return segment
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function resolveLocalRoot() {
  return path.resolve(env.STORAGE_LOCAL_DIRECTORY);
}

function resolveStorageProvider() {
  return env.STORAGE_PROVIDER === "s3" ? StorageProvider.S3 : StorageProvider.LOCAL;
}

function buildPublicUrlFromKey(key: string) {
  if (resolveStorageProvider() === StorageProvider.S3 && env.S3_PUBLIC_BASE_URL) {
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }

  return null;
}

function getS3Client() {
  if (globalForStorage.s3Client) {
    return globalForStorage.s3Client;
  }

  if (!env.S3_BUCKET_NAME || !env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 storage is not fully configured.");
  }

  globalForStorage.s3Client = new S3Client({
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: isTruthyFlag(env.S3_FORCE_PATH_STYLE),
    region: env.S3_REGION,
  });

  return globalForStorage.s3Client;
}

async function readS3Body(body: unknown) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return Buffer.from(await body.transformToByteArray());
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export function buildStorageKey(...segments: string[]) {
  return segments
    .map((segment) => sanitizeStorageSegment(segment))
    .filter(Boolean)
    .join("/");
}

export async function putStoredObject(input: PutStoredObjectInput): Promise<StoredObjectResult> {
  const provider = resolveStorageProvider();
  const key = sanitizeStorageSegment(input.key);

  if (provider === StorageProvider.LOCAL) {
    const localRoot = resolveLocalRoot();
    const filePath = path.resolve(localRoot, key);
    const fileDirectory = path.dirname(filePath);

    if (!filePath.startsWith(localRoot)) {
      throw new Error("Resolved storage path is outside the configured storage directory.");
    }

    await mkdir(fileDirectory, { recursive: true });
    await writeFile(filePath, input.body);

    return {
      key,
      provider,
      publicUrl: null,
    };
  }

  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Body: input.body,
      Bucket: env.S3_BUCKET_NAME,
      ContentType: input.contentType,
      Key: key,
    }),
  );

  return {
    key,
    provider,
    publicUrl: buildPublicUrlFromKey(key),
  };
}

export async function readStoredObject(input: ReadStoredObjectInput) {
  const provider = input.provider ?? resolveStorageProvider();

  if (!input.key) {
    throw new Error("A storage key is required to read a stored object.");
  }

  if (provider === StorageProvider.LOCAL) {
    const localRoot = resolveLocalRoot();
    const filePath = path.resolve(localRoot, input.key);
    if (!filePath.startsWith(localRoot)) {
      throw new Error("Resolved storage path is outside the configured storage directory.");
    }
    return readFile(filePath);
  }

  const client = getS3Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: input.key,
    }),
  );

  return readS3Body(response.Body);
}

export function buildStoredObjectPublicUrl(key: string | null | undefined) {
  if (!key) {
    return null;
  }

  return buildPublicUrlFromKey(key);
}

export async function storeTextObject(
  key: string,
  contentType: string,
  body: string,
) {
  return putStoredObject({
    body,
    contentType,
    key,
  });
}

export async function storeBinaryObject(
  key: string,
  contentType: string,
  body: Buffer | Uint8Array,
) {
  return putStoredObject({
    body,
    contentType,
    key,
  });
}

export function logStorageFallback(message: string, meta?: Record<string, unknown>) {
  logger.warn(message, meta);
}
