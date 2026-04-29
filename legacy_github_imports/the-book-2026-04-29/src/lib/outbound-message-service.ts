import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderReplyPolicy, type ReplyPolicyContext } from "@/lib/reply-policies";
import type { OutboundMessagePolicyId, OutboundMessageRecord } from "@/lib/types";

const DATA_DIRECTORY = path.join(process.cwd(), "runtime-data");
const DATA_FILE = path.join(DATA_DIRECTORY, "outbound-messages.json");

interface OutboundMessageDocument {
  version: 1;
  messages: OutboundMessageRecord[];
  updatedAt: string;
}

function createDefaultDocument(): OutboundMessageDocument {
  return {
    version: 1,
    messages: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDocument(document: Partial<OutboundMessageDocument> | null) {
  const baseDocument = createDefaultDocument();

  if (!document || typeof document !== "object") {
    return baseDocument;
  }

  return {
    version: 1 as const,
    messages: Array.isArray(document.messages) ? document.messages : [],
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
    return normalizeDocument(
      JSON.parse(rawDocument) as Partial<OutboundMessageDocument>,
    );
  } catch {
    const fallbackDocument = createDefaultDocument();
    await writeDocument(fallbackDocument);
    return fallbackDocument;
  }
}

async function writeDocument(document: OutboundMessageDocument) {
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
  callback: (document: OutboundMessageDocument) => Promise<T> | T,
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

export async function recordOutboundPolicyMessage(input: {
  tenantId: string;
  dealId: string;
  conversationId: string;
  channel: OutboundMessageRecord["channel"];
  actorName: string;
  policyId: OutboundMessagePolicyId;
  context: ReplyPolicyContext;
}) {
  const now = new Date().toISOString();
  const body = renderReplyPolicy(input.policyId, input.context);

  const messageRecord: OutboundMessageRecord = {
    id: randomUUID(),
    tenantId: input.tenantId,
    dealId: input.dealId,
    conversationId: input.conversationId,
    policyId: input.policyId,
    channel: input.channel,
    actorName: input.actorName,
    body,
    deliveryStatus: "SIMULATED_SENT",
    sentAt: now,
    createdAt: now,
  };

  await withDocumentLock(async (document) => {
    document.messages = [messageRecord, ...document.messages];
    await writeDocument(document);
  });

  return messageRecord;
}

export async function getOutboundMessageSnapshot(tenantId: string) {
  return withDocumentLock(async (document) => {
    return document.messages
      .filter((message) => message.tenantId === tenantId)
      .sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt));
  });
}

export async function resetOutboundMessagesTenant(tenantId: string) {
  return withDocumentLock(async (document) => {
    document.messages = document.messages.filter(
      (message) => message.tenantId !== tenantId,
    );

    await writeDocument(document);
  });
}
