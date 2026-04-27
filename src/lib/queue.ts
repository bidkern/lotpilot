import PgBoss from "pg-boss";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const QUEUE_NAMES = {
  conversationResponse: "conversation-response",
  exportGeneration: "export-generation",
  inventorySync: "inventory-sync",
  providerSync: "provider-sync",
  publicationArchive: "publication-archive",
  publicationCreate: "publication-create",
  publicationUpdate: "publication-update",
  vehicleRefresh: "vehicle-refresh",
} as const;

export const DEAD_LETTER_QUEUE_NAMES = {
  conversationResponse: "conversation-response-dlq",
  exportGeneration: "export-generation-dlq",
  inventorySync: "inventory-sync-dlq",
  providerSync: "provider-sync-dlq",
  publicationArchive: "publication-archive-dlq",
  publicationCreate: "publication-create-dlq",
  publicationUpdate: "publication-update-dlq",
  vehicleRefresh: "vehicle-refresh-dlq",
} as const;

const queueDefinitions = [
  {
    deadLetterName: DEAD_LETTER_QUEUE_NAMES.conversationResponse,
    name: QUEUE_NAMES.conversationResponse,
  },
  {
    deadLetterName: DEAD_LETTER_QUEUE_NAMES.exportGeneration,
    name: QUEUE_NAMES.exportGeneration,
  },
  {
    deadLetterName: DEAD_LETTER_QUEUE_NAMES.inventorySync,
    name: QUEUE_NAMES.inventorySync,
  },
  {
    deadLetterName: DEAD_LETTER_QUEUE_NAMES.providerSync,
    name: QUEUE_NAMES.providerSync,
  },
  {
    deadLetterName: DEAD_LETTER_QUEUE_NAMES.publicationArchive,
    name: QUEUE_NAMES.publicationArchive,
  },
  {
    deadLetterName: DEAD_LETTER_QUEUE_NAMES.publicationCreate,
    name: QUEUE_NAMES.publicationCreate,
  },
  {
    deadLetterName: DEAD_LETTER_QUEUE_NAMES.publicationUpdate,
    name: QUEUE_NAMES.publicationUpdate,
  },
  {
    deadLetterName: DEAD_LETTER_QUEUE_NAMES.vehicleRefresh,
    name: QUEUE_NAMES.vehicleRefresh,
  },
] as const;

const globalForQueue = globalThis as unknown as {
  pgBoss: PgBoss | undefined;
};

async function ensureQueues(boss: PgBoss) {
  for (const definition of queueDefinitions) {
    const deadLetterQueue = await boss.getQueue(definition.deadLetterName);
    if (!deadLetterQueue) {
      await boss.createQueue(definition.deadLetterName);
    }

    const queue = await boss.getQueue(definition.name);
    if (!queue) {
      await boss.createQueue(definition.name, {
        deadLetter: definition.deadLetterName,
      });
      continue;
    }

    if (queue.deadLetter !== definition.deadLetterName) {
      await boss.updateQueue(definition.name, {
        deadLetter: definition.deadLetterName,
      });
    }
  }
}

export async function getQueue() {
  if (!globalForQueue.pgBoss) {
    globalForQueue.pgBoss = new PgBoss({
      connectionString: env.DATABASE_URL,
    });

    globalForQueue.pgBoss.on("error", (error) => {
      logger.error("Queue error", { error: error instanceof Error ? error.message : String(error) });
    });

    await globalForQueue.pgBoss.start();
    await ensureQueues(globalForQueue.pgBoss);
  }

  return globalForQueue.pgBoss;
}

export async function stopQueue() {
  if (globalForQueue.pgBoss) {
    await globalForQueue.pgBoss.stop();
    globalForQueue.pgBoss = undefined;
  }
}
