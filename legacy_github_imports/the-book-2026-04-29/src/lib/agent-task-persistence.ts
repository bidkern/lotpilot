import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentTaskKind,
  AgentTaskRecord,
  AgentWorkerSummary,
} from "@/lib/types";

const DATA_DIRECTORY = path.join(process.cwd(), "runtime-data");
const DATA_FILE = path.join(DATA_DIRECTORY, "agent-tasks.json");

interface AgentTaskDocument {
  version: 1;
  tasks: AgentTaskRecord[];
  lastRunSummary?: AgentWorkerSummary;
  updatedAt: string;
}

export interface AgentTaskDraft {
  tenantId: string;
  dealId: string;
  conversationId: string;
  kind: AgentTaskKind;
  title: string;
  reason: string;
  scheduledFor: string;
  followUpStep?: number;
  messageDraft?: string;
  appointmentWindow?: string;
  managerReason?: string;
}

function createDefaultDocument(): AgentTaskDocument {
  return {
    version: 1,
    tasks: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDocument(document: Partial<AgentTaskDocument> | null) {
  const baseDocument = createDefaultDocument();

  if (!document || typeof document !== "object") {
    return baseDocument;
  }

  return {
    version: 1 as const,
    tasks: Array.isArray(document.tasks) ? document.tasks : [],
    lastRunSummary: document.lastRunSummary,
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
    const parsedDocument = JSON.parse(rawDocument) as Partial<AgentTaskDocument>;
    return normalizeDocument(parsedDocument);
  } catch {
    const fallbackDocument = createDefaultDocument();
    await writeDocument(fallbackDocument);
    return fallbackDocument;
  }
}

async function writeDocument(document: AgentTaskDocument) {
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
  callback: (document: AgentTaskDocument) => Promise<T> | T,
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

function sortTasks(tasks: AgentTaskRecord[]) {
  return [...tasks].sort((left, right) => {
    const scheduledDelta =
      Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor);

    if (scheduledDelta !== 0) {
      return scheduledDelta;
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function hasActiveTask(
  document: AgentTaskDocument,
  draft: AgentTaskDraft,
) {
  return document.tasks.some(
    (task) =>
      task.tenantId === draft.tenantId &&
      task.dealId === draft.dealId &&
      task.kind === draft.kind &&
      (task.status === "PENDING" || task.status === "RUNNING"),
  );
}

export async function queueAgentTasks(drafts: AgentTaskDraft[]) {
  if (drafts.length === 0) {
    return 0;
  }

  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();
    let scheduledCount = 0;

    for (const draft of drafts) {
      if (hasActiveTask(document, draft)) {
        continue;
      }

      scheduledCount += 1;
      document.tasks = [
        ...document.tasks,
        {
          id: randomUUID(),
          tenantId: draft.tenantId,
          dealId: draft.dealId,
          conversationId: draft.conversationId,
          kind: draft.kind,
          status: "PENDING",
          title: draft.title,
          reason: draft.reason,
          scheduledFor: draft.scheduledFor,
          attemptCount: 0,
          followUpStep: draft.followUpStep,
          messageDraft: draft.messageDraft,
          appointmentWindow: draft.appointmentWindow,
          managerReason: draft.managerReason,
          createdAt: now,
          updatedAt: now,
        },
      ];
    }

    await writeDocument(document);
    return scheduledCount;
  });
}

export async function claimDueAgentTasks(
  tenantId: string,
  dueBefore: string,
  limit = 12,
) {
  return withDocumentLock(async (document) => {
    const dueTasks = sortTasks(
      document.tasks.filter(
        (task) =>
          task.tenantId === tenantId &&
          task.status === "PENDING" &&
          Date.parse(task.scheduledFor) <= Date.parse(dueBefore),
      ),
    ).slice(0, limit);

    document.tasks = document.tasks.map((task) => {
      if (!dueTasks.some((dueTask) => dueTask.id === task.id)) {
        return task;
      }

      return {
        ...task,
        status: "RUNNING" as const,
        attemptCount: task.attemptCount + 1,
        startedAt: dueBefore,
        updatedAt: dueBefore,
      };
    });

    await writeDocument(document);

    return sortTasks(
      document.tasks.filter((task) => dueTasks.some((dueTask) => dueTask.id === task.id)),
    );
  });
}

export async function finalizeAgentTask(
  taskId: string,
  input: {
    status: "SUCCEEDED" | "FAILED" | "CANCELED";
    lastError?: string;
    nextTasks?: AgentTaskDraft[];
  },
) {
  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();

    document.tasks = document.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }

      return {
        ...task,
        status: input.status,
        completedAt: input.status === "SUCCEEDED" ? now : task.completedAt,
        lastError: input.lastError,
        updatedAt: now,
      };
    });

    if (input.nextTasks?.length) {
      for (const draft of input.nextTasks) {
        if (hasActiveTask(document, draft)) {
          continue;
        }

        document.tasks = [
          ...document.tasks,
          {
            id: randomUUID(),
            tenantId: draft.tenantId,
            dealId: draft.dealId,
            conversationId: draft.conversationId,
            kind: draft.kind,
            status: "PENDING",
            title: draft.title,
            reason: draft.reason,
            scheduledFor: draft.scheduledFor,
            attemptCount: 0,
            followUpStep: draft.followUpStep,
            messageDraft: draft.messageDraft,
            appointmentWindow: draft.appointmentWindow,
            managerReason: draft.managerReason,
            createdAt: now,
            updatedAt: now,
          },
        ];
      }
    }

    await writeDocument(document);
  });
}

export async function cancelPendingAgentTasksForDeal(
  tenantId: string,
  dealId: string,
) {
  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();

    document.tasks = document.tasks.map((task) => {
      if (
        task.tenantId !== tenantId ||
        task.dealId !== dealId ||
        task.status !== "PENDING"
      ) {
        return task;
      }

      return {
        ...task,
        status: "CANCELED" as const,
        updatedAt: now,
      };
    });

    await writeDocument(document);
  });
}

export async function recordAgentWorkerSummary(summary: AgentWorkerSummary) {
  return withDocumentLock(async (document) => {
    document.lastRunSummary = summary;
    await writeDocument(document);
  });
}

export async function getAgentTaskSnapshot(tenantId: string) {
  return withDocumentLock(async (document) => {
    const tasks = sortTasks(
      document.tasks.filter((task) => task.tenantId === tenantId),
    );

    return {
      tasks,
      lastRunSummary: document.lastRunSummary?.tenantId === tenantId
        ? document.lastRunSummary
        : undefined,
    };
  });
}

export async function resetAgentTasksTenant(tenantId: string) {
  return withDocumentLock(async (document) => {
    document.tasks = document.tasks.filter((task) => task.tenantId !== tenantId);

    if (document.lastRunSummary?.tenantId === tenantId) {
      document.lastRunSummary = undefined;
    }

    await writeDocument(document);
  });
}
