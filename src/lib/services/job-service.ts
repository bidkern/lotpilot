import {
  JobPriority,
  QueueJobStatus,
  type BackgroundJob,
  type Prisma,
} from "@prisma/client";

import { DEAD_LETTER_QUEUE_NAMES, QUEUE_NAMES, getQueue } from "@/lib/queue";
import { prisma } from "@/lib/prisma";

type EnqueueJobInput = {
  createdById?: string | null;
  deadLetterQueueName?: string | null;
  idempotencyKeyId?: string | null;
  maxAttempts?: number;
  payload?: Prisma.InputJsonValue;
  priority?: JobPriority;
  queueName: string;
  retryDelaySeconds?: number;
  sourceId?: string | null;
  tenantId: string;
  type: BackgroundJob["type"];
};

const priorityMap: Record<JobPriority, number> = {
  HIGH: 10,
  LOW: 1,
  NORMAL: 5,
};

function resolveDeadLetterQueueName(queueName: string) {
  if (queueName === QUEUE_NAMES.conversationResponse) {
    return DEAD_LETTER_QUEUE_NAMES.conversationResponse;
  }

  if (queueName === QUEUE_NAMES.inventorySync) {
    return DEAD_LETTER_QUEUE_NAMES.inventorySync;
  }

  if (queueName === QUEUE_NAMES.providerSync) {
    return DEAD_LETTER_QUEUE_NAMES.providerSync;
  }

  if (queueName === QUEUE_NAMES.publicationCreate) {
    return DEAD_LETTER_QUEUE_NAMES.publicationCreate;
  }

  if (queueName === QUEUE_NAMES.publicationUpdate) {
    return DEAD_LETTER_QUEUE_NAMES.publicationUpdate;
  }

  if (queueName === QUEUE_NAMES.publicationArchive) {
    return DEAD_LETTER_QUEUE_NAMES.publicationArchive;
  }

  if (queueName === QUEUE_NAMES.vehicleRefresh) {
    return DEAD_LETTER_QUEUE_NAMES.vehicleRefresh;
  }

  return DEAD_LETTER_QUEUE_NAMES.exportGeneration;
}

export async function enqueueBackgroundJob(input: EnqueueJobInput) {
  const maxAttempts = input.maxAttempts ?? 3;
  const backgroundJob = await prisma.backgroundJob.create({
    data: {
      createdById: input.createdById ?? undefined,
      deadLetterQueueName: input.deadLetterQueueName ?? resolveDeadLetterQueueName(input.queueName),
      idempotencyKeyId: input.idempotencyKeyId ?? undefined,
      maxAttempts,
      payload: input.payload,
      priority: input.priority ?? JobPriority.NORMAL,
      queueName: input.queueName,
      sourceId: input.sourceId ?? undefined,
      tenantId: input.tenantId,
      type: input.type,
    },
  });

  try {
    const queue = await getQueue();
    const externalJobId = await queue.send(
      input.queueName,
      {
        backgroundJobId: backgroundJob.id,
        ...(typeof input.payload === "object" && input.payload ? input.payload : {}),
      },
      {
        deleteAfterSeconds: 60 * 60 * 24 * 7,
        priority: priorityMap[input.priority ?? JobPriority.NORMAL],
        retryBackoff: true,
        retryDelay: input.retryDelaySeconds ?? 30,
        retryDelayMax: 60 * 5,
        retryLimit: maxAttempts,
      },
    );

    return prisma.backgroundJob.update({
      where: {
        id: backgroundJob.id,
      },
      data: {
        externalJobId,
      },
    });
  } catch (error) {
    await prisma.backgroundJob.update({
      where: {
        id: backgroundJob.id,
      },
      data: {
        errorText: error instanceof Error ? error.message : "Unable to enqueue background job.",
        finishedAt: new Date(),
        status: QueueJobStatus.FAILED,
      },
    });
    throw error;
  }
}

export async function markBackgroundJobStarted(
  backgroundJobId: string,
  input?: {
    attemptCount?: number;
    maxAttempts?: number;
  },
) {
  return prisma.backgroundJob.update({
    where: {
      id: backgroundJobId,
    },
    data: {
      attempts: input?.attemptCount ?? { increment: 1 },
      maxAttempts: input?.maxAttempts ?? undefined,
      retryAt: null,
      startedAt: new Date(),
      status: QueueJobStatus.PROCESSING,
    },
  });
}

export async function markBackgroundJobCompleted(
  backgroundJobId: string,
  result?: Prisma.InputJsonValue,
) {
  return prisma.backgroundJob.update({
    where: {
      id: backgroundJobId,
    },
    data: {
      deadLetteredAt: null,
      finishedAt: new Date(),
      result,
      retryAt: null,
      status: QueueJobStatus.COMPLETED,
    },
  });
}

export async function markBackgroundJobRetrying(
  backgroundJobId: string,
  errorText: string,
  retryAt?: Date | null,
) {
  return prisma.backgroundJob.update({
    where: {
      id: backgroundJobId,
    },
    data: {
      errorText,
      retryAt: retryAt ?? undefined,
      status: QueueJobStatus.RETRYING,
    },
  });
}

export async function markBackgroundJobFailed(
  backgroundJobId: string,
  errorText: string,
  result?: Prisma.InputJsonValue,
) {
  return prisma.backgroundJob.update({
    where: {
      id: backgroundJobId,
    },
    data: {
      errorText,
      finishedAt: new Date(),
      result,
      retryAt: null,
      status: QueueJobStatus.FAILED,
    },
  });
}

export async function markBackgroundJobDeadLettered(input: {
  backgroundJobId: string;
  deadLetterQueueName: string;
  errorText: string;
  result?: Prisma.InputJsonValue;
}) {
  return prisma.backgroundJob.update({
    where: {
      id: input.backgroundJobId,
    },
    data: {
      deadLetterQueueName: input.deadLetterQueueName,
      deadLetteredAt: new Date(),
      errorText: input.errorText,
      finishedAt: new Date(),
      result: input.result,
      retryAt: null,
      status: QueueJobStatus.DEAD_LETTERED,
    },
  });
}

export async function syncLinkedJobStatus(
  backgroundJob: Pick<BackgroundJob, "id" | "status" | "errorText" | "finishedAt">,
) {
  await prisma.$transaction([
    prisma.exportJob.updateMany({
      where: {
        backgroundJobId: backgroundJob.id,
      },
      data: {
        completedAt: backgroundJob.finishedAt ?? undefined,
        errorText: backgroundJob.errorText ?? undefined,
        status: backgroundJob.status,
      },
    }),
    prisma.syncRun.updateMany({
      where: {
        backgroundJobId: backgroundJob.id,
      },
      data: {
        finishedAt: backgroundJob.finishedAt ?? undefined,
        status: backgroundJob.status,
      },
    }),
  ]);
}
