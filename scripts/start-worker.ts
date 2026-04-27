import "dotenv/config";

import { QueueJobType } from "@prisma/client";
import type PgBoss from "pg-boss";

import { prisma } from "../src/lib/prisma";
import {
  DEAD_LETTER_QUEUE_NAMES,
  getQueue,
  QUEUE_NAMES,
  stopQueue,
} from "../src/lib/queue";
import { stopPlaywrightPool } from "../src/lib/source-adapters/playwright-pool";
import { executeConversationResponse } from "../src/lib/services/conversation-service";
import { executeExportJob, failExportJob } from "../src/lib/services/export-service";
import { executeInventoryProviderSync } from "../src/lib/services/inventory-provider-service";
import { executeSourceSync, executeVehicleRefresh } from "../src/lib/services/inventory-service";
import {
  markBackgroundJobCompleted,
  markBackgroundJobDeadLettered,
  markBackgroundJobRetrying,
  markBackgroundJobStarted,
  syncLinkedJobStatus,
} from "../src/lib/services/job-service";
import { executePublicationJob } from "../src/lib/services/publication-service";

type WorkerPayload = {
  backgroundJobId?: string;
  conversationId?: string;
  exportJobId?: string;
  messageId?: string;
  providerConnectionId?: string;
  publicationId?: string;
  sourceId?: string;
  syncRunId?: string;
  vehicleIds?: string[];
};

type ResolvedSyncPayload = WorkerPayload & {
  backgroundJobId: string;
  syncRunId: string;
};

async function ensureScheduledSyncIdentifiers(payload: WorkerPayload): Promise<ResolvedSyncPayload> {
  if (payload.backgroundJobId && payload.syncRunId) {
    return payload as ResolvedSyncPayload;
  }

  if (!payload.sourceId) {
    throw new Error("Missing identifiers for source sync job.");
  }

  const source = await prisma.inventorySource.findUnique({
    where: {
      id: payload.sourceId,
    },
  });

  if (!source) {
    throw new Error(`Inventory source not found: ${payload.sourceId}`);
  }

  const backgroundJob = await prisma.backgroundJob.create({
    data: {
      queueName: QUEUE_NAMES.inventorySync,
      sourceId: source.id,
      status: "QUEUED",
      tenantId: source.tenantId,
      type: QueueJobType.SOURCE_SYNC,
    },
  });

  const syncRun = await prisma.syncRun.create({
    data: {
      backgroundJobId: backgroundJob.id,
      sourceId: source.id,
      status: "QUEUED",
      tenantId: source.tenantId,
    },
  });

  return {
    ...payload,
    backgroundJobId: backgroundJob.id,
    syncRunId: syncRun.id,
  };
}

function isFinalAttempt(job: Pick<PgBoss.JobWithMetadata<unknown>, "retryCount" | "retryLimit">) {
  return job.retryCount + 1 >= job.retryLimit;
}

async function main() {
  const queue = await getQueue();

  await queue.work(QUEUE_NAMES.inventorySync, { includeMetadata: true }, async ([job]) => {
    const payload = await ensureScheduledSyncIdentifiers(job.data as WorkerPayload);

    await markBackgroundJobStarted(payload.backgroundJobId, {
      attemptCount: job.retryCount + 1,
      maxAttempts: job.retryLimit,
    });

    try {
      const result = await executeSourceSync(payload.syncRunId);
      const backgroundJob = await markBackgroundJobCompleted(payload.backgroundJobId, result as never);
      await syncLinkedJobStatus(backgroundJob);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Source sync failed.";
      const backgroundJob = isFinalAttempt(job)
        ? await markBackgroundJobDeadLettered({
            backgroundJobId: payload.backgroundJobId,
            deadLetterQueueName: job.deadLetter || DEAD_LETTER_QUEUE_NAMES.inventorySync,
            errorText: message,
          })
        : await markBackgroundJobRetrying(payload.backgroundJobId, message);
      await syncLinkedJobStatus(backgroundJob);
      throw error;
    }
  });

  await queue.work(QUEUE_NAMES.exportGeneration, { includeMetadata: true }, async ([job]) => {
    const payload = job.data as WorkerPayload;
    if (!payload.backgroundJobId || !payload.exportJobId) {
      throw new Error("Missing identifiers for export job.");
    }
    const backgroundJobId = payload.backgroundJobId;
    const exportJobId = payload.exportJobId;

    await markBackgroundJobStarted(backgroundJobId, {
      attemptCount: job.retryCount + 1,
      maxAttempts: job.retryLimit,
    });

    try {
      const result = await executeExportJob(exportJobId);
      const backgroundJob = await markBackgroundJobCompleted(backgroundJobId, result as never);
      await syncLinkedJobStatus(backgroundJob);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export job failed.";
      const backgroundJob = isFinalAttempt(job)
        ? await (async () => {
            await failExportJob(exportJobId, message);
            return markBackgroundJobDeadLettered({
              backgroundJobId,
              deadLetterQueueName: job.deadLetter || DEAD_LETTER_QUEUE_NAMES.exportGeneration,
              errorText: message,
            });
          })()
        : await markBackgroundJobRetrying(backgroundJobId, message);
      await syncLinkedJobStatus(backgroundJob);
      throw error;
    }
  });

  await queue.work(QUEUE_NAMES.vehicleRefresh, { includeMetadata: true }, async ([job]) => {
    const payload = job.data as WorkerPayload;
    if (!payload.backgroundJobId || !payload.vehicleIds?.length) {
      throw new Error("Missing identifiers for vehicle refresh job.");
    }
    const backgroundJobId = payload.backgroundJobId;
    const vehicleIds = payload.vehicleIds;

    await markBackgroundJobStarted(backgroundJobId, {
      attemptCount: job.retryCount + 1,
      maxAttempts: job.retryLimit,
    });

    try {
      const result = await executeVehicleRefresh(backgroundJobId, vehicleIds);
      await markBackgroundJobCompleted(backgroundJobId, result as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Vehicle refresh failed.";
      if (isFinalAttempt(job)) {
        await markBackgroundJobDeadLettered({
          backgroundJobId,
          deadLetterQueueName: job.deadLetter || DEAD_LETTER_QUEUE_NAMES.vehicleRefresh,
          errorText: message,
        });
      } else {
        await markBackgroundJobRetrying(backgroundJobId, message);
      }
      throw error;
    }
  });

  await queue.work(QUEUE_NAMES.providerSync, { includeMetadata: true }, async ([job]) => {
    const payload = job.data as WorkerPayload;
    if (!payload.backgroundJobId || !payload.providerConnectionId) {
      throw new Error("Missing identifiers for provider sync job.");
    }

    const backgroundJobId = payload.backgroundJobId;

    await markBackgroundJobStarted(backgroundJobId, {
      attemptCount: job.retryCount + 1,
      maxAttempts: job.retryLimit,
    });

    try {
      const result = await executeInventoryProviderSync(backgroundJobId, payload.providerConnectionId);
      await markBackgroundJobCompleted(backgroundJobId, result as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider sync failed.";
      if (isFinalAttempt(job)) {
        await markBackgroundJobDeadLettered({
          backgroundJobId,
          deadLetterQueueName: job.deadLetter || DEAD_LETTER_QUEUE_NAMES.providerSync,
          errorText: message,
        });
      } else {
        await markBackgroundJobRetrying(backgroundJobId, message);
      }
      throw error;
    }
  });

  for (const queueName of [
    QUEUE_NAMES.publicationCreate,
    QUEUE_NAMES.publicationUpdate,
    QUEUE_NAMES.publicationArchive,
  ] as const) {
    await queue.work(queueName, { includeMetadata: true }, async ([job]) => {
      const payload = job.data as WorkerPayload;
      if (!payload.backgroundJobId || !payload.publicationId) {
        throw new Error("Missing identifiers for publication job.");
      }

      const backgroundJobId = payload.backgroundJobId;

      await markBackgroundJobStarted(backgroundJobId, {
        attemptCount: job.retryCount + 1,
        maxAttempts: job.retryLimit,
      });

      try {
        const queueJobType =
          queueName === QUEUE_NAMES.publicationArchive
            ? QueueJobType.PUBLICATION_ARCHIVE
            : queueName === QUEUE_NAMES.publicationUpdate
              ? QueueJobType.PUBLICATION_UPDATE
              : QueueJobType.PUBLICATION_CREATE;
        const result = await executePublicationJob(
          backgroundJobId,
          payload.publicationId,
          queueJobType,
        );
        await markBackgroundJobCompleted(backgroundJobId, result as never);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Publication job failed.";
        if (isFinalAttempt(job)) {
          await markBackgroundJobDeadLettered({
            backgroundJobId,
            deadLetterQueueName:
              job.deadLetter ||
              (queueName === QUEUE_NAMES.publicationArchive
                ? DEAD_LETTER_QUEUE_NAMES.publicationArchive
                : queueName === QUEUE_NAMES.publicationUpdate
                  ? DEAD_LETTER_QUEUE_NAMES.publicationUpdate
                  : DEAD_LETTER_QUEUE_NAMES.publicationCreate),
            errorText: message,
          });
        } else {
          await markBackgroundJobRetrying(backgroundJobId, message);
        }
        throw error;
      }
    });
  }

  await queue.work(QUEUE_NAMES.conversationResponse, { includeMetadata: true }, async ([job]) => {
    const payload = job.data as WorkerPayload;
    if (!payload.backgroundJobId || !payload.conversationId) {
      throw new Error("Missing identifiers for conversation response job.");
    }

    const backgroundJobId = payload.backgroundJobId;

    await markBackgroundJobStarted(backgroundJobId, {
      attemptCount: job.retryCount + 1,
      maxAttempts: job.retryLimit,
    });

    try {
      const result = await executeConversationResponse(backgroundJobId, payload.conversationId);
      await markBackgroundJobCompleted(backgroundJobId, result as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conversation response failed.";
      if (isFinalAttempt(job)) {
        await markBackgroundJobDeadLettered({
          backgroundJobId,
          deadLetterQueueName: job.deadLetter || DEAD_LETTER_QUEUE_NAMES.conversationResponse,
          errorText: message,
        });
      } else {
        await markBackgroundJobRetrying(backgroundJobId, message);
      }
      throw error;
    }
  });

  console.log(`Worker online for ${Object.values(QUEUE_NAMES).join(", ")}`);
}

main().catch(async (error) => {
  console.error(error);
  await stopPlaywrightPool();
  await stopQueue();
  await prisma.$disconnect();
  process.exit(1);
});

async function shutdown() {
  await stopPlaywrightPool();
  await stopQueue();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
