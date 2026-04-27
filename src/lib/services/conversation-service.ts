import {
  ConversationStatus,
  HandoffStatus,
  JobPriority,
  MessageAuthorType,
  MessageDirection,
  QueueJobType,
  UserRole,
  type MessagingConnection,
  type Prisma,
  VehicleLifecycleStatus,
} from "@prisma/client";

import { createAuditLog } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { QUEUE_NAMES } from "@/lib/queue";
import { redactSensitiveText, redactSensitiveValue } from "@/lib/redaction";
import { enqueueBackgroundJob } from "@/lib/services/job-service";
import {
  buildIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  reserveIdempotencyKey,
} from "@/lib/services/idempotency-service";
import {
  findMessagingConnectionByPageId,
  getSafeMetaAuthAccountSummary,
  getSafeMessagingConnectionSummary,
  markMessagingWebhookProcessed,
  recordMessagingWebhookEvent,
  sendMessengerTextReply,
} from "@/lib/services/meta-service";
import { getAssignedUserIdForVehicle } from "@/lib/services/listing-assignment-service";

type MetaWebhookMessage = {
  is_echo?: boolean;
  mid?: string;
  text?: string;
};

type MetaWebhookPostback = {
  payload?: string;
  title?: string;
};

type MetaWebhookMessagingEvent = {
  message?: MetaWebhookMessage;
  postback?: MetaWebhookPostback;
  recipient?: {
    id?: string;
  };
  sender?: {
    id?: string;
  };
  timestamp?: number;
};

type MetaWebhookEntry = {
  id?: string;
  messaging?: MetaWebhookMessagingEvent[];
  time?: number;
};

type MetaWebhookPayload = {
  entry?: MetaWebhookEntry[];
  object?: string;
};

type ResponsePlan =
  | {
      confidence: number;
      kind: "handoff";
      reason: string;
      replyText: string;
      vehicleId?: string | null;
    }
  | {
      confidence: number;
      kind: "reply";
      replyText: string;
      vehicleId?: string | null;
    };

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function canViewTenantConversationInbox(role: UserRole) {
  return role === UserRole.OWNER || role === UserRole.ADMIN || role === UserRole.MANAGER;
}

function buildConversationViewerWhere(input?: {
  role: UserRole;
  userId: string;
}): Prisma.ConversationWhereInput {
  if (!input || canViewTenantConversationInbox(input.role)) {
    return {};
  }

  return {
    OR: [
      {
        assignedToId: input.userId,
      },
      {
        assignedToId: null,
      },
    ],
  };
}

function normalizeMessageText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "price not listed yet";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatMileage(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "mileage not listed yet";
  }

  return `${new Intl.NumberFormat("en-US").format(value)} miles`;
}

function vehicleDisplayName(vehicle: {
  make: string | null;
  model: string | null;
  title: string | null;
  trim: string | null;
  year: number | null;
}) {
  return (
    vehicle.title ||
    [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ").trim() ||
    "that vehicle"
  );
}

function buildVehicleResponse(vehicle: {
  condition: string;
  detailPageUrl: string;
  drivetrain: string | null;
  engine: string | null;
  exteriorColor: string | null;
  fuelType: string | null;
  lastSeenAt: Date;
  make: string | null;
  mileage: number | null;
  model: string | null;
  price: number | null;
  stockNumber: string | null;
  title: string | null;
  transmission: string | null;
  trim: string | null;
  year: number | null;
}) {
  const displayName = vehicleDisplayName(vehicle);
  const specs = [vehicle.engine, vehicle.transmission, vehicle.drivetrain, vehicle.fuelType]
    .filter(Boolean)
    .join(" | ");

  return [
    `${displayName} is currently in the inventory.`,
    `Price: ${formatCurrency(vehicle.price)}.`,
    `Mileage: ${formatMileage(vehicle.mileage)}.`,
    vehicle.stockNumber ? `Stock: ${vehicle.stockNumber}.` : null,
    specs ? `Specs: ${specs}.` : null,
    vehicle.exteriorColor ? `Exterior: ${vehicle.exteriorColor}.` : null,
    `Last synced ${vehicle.lastSeenAt.toLocaleString("en-US")}.`,
    `Listing: ${vehicle.detailPageUrl}`,
  ]
    .filter(Boolean)
    .join(" ");
}

const HIGH_RISK_PATTERNS = [
  /\b(ssn|social security|driver'?s license|credit card|bank account)\b/i,
  /\b(finance|financing|loan|apr|interest rate|monthly payment|payment)\b/i,
  /\b(credit app|credit application|approved|approval)\b/i,
  /\b(lawsuit|attorney|legal|complaint|fraud|scam)\b/i,
  /\b(trade[- ]?in value|appraisal|payoff)\b/i,
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "available",
  "book",
  "car",
  "cars",
  "do",
  "for",
  "have",
  "hello",
  "hey",
  "hi",
  "i",
  "in",
  "inventory",
  "is",
  "it",
  "looking",
  "me",
  "of",
  "on",
  "or",
  "price",
  "show",
  "stock",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "used",
  "vehicle",
  "what",
  "with",
]);

function extractEmail(text: string) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
}

function extractPhone(text: string) {
  const match = text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}/);
  return match?.[0] ?? null;
}

function extractStockNumber(text: string) {
  const prefixedMatch = text.match(/\bstock(?:\s*(?:number|no\.?|#))?\s*[:#-]?\s*([a-z0-9-]{3,})\b/i);
  if (prefixedMatch?.[1]) {
    return prefixedMatch[1].toUpperCase();
  }

  return null;
}

function extractVin(text: string) {
  return text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase() ?? null;
}

function extractUrls(text: string) {
  return Array.from(text.matchAll(/https?:\/\/[^\s]+/gi), (match) => match[0]);
}

function tokenizeInventorySearch(text: string) {
  return normalizeMessageText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

async function matchVehicleFromText(input: {
  existingVehicleId?: string | null;
  tenantId: string;
  text: string;
}) {
  if (input.existingVehicleId) {
    const existingVehicle = await prisma.vehicle.findFirst({
      where: {
        id: input.existingVehicleId,
        tenantId: input.tenantId,
      },
    });

    if (existingVehicle) {
      return existingVehicle;
    }
  }

  const vin = extractVin(input.text);
  if (vin) {
    const vehicleByVin = await prisma.vehicle.findFirst({
      where: {
        tenantId: input.tenantId,
        vin,
      },
    });

    if (vehicleByVin) {
      return vehicleByVin;
    }
  }

  const stockNumber = extractStockNumber(input.text);
  if (stockNumber) {
    const vehicleByStock = await prisma.vehicle.findFirst({
      where: {
        stockNumber: {
          equals: stockNumber,
          mode: "insensitive",
        },
        tenantId: input.tenantId,
      },
    });

    if (vehicleByStock) {
      return vehicleByStock;
    }
  }

  const urls = extractUrls(input.text);
  if (urls.length) {
    const vehicleByUrl = await prisma.vehicle.findFirst({
      where: {
        OR: [
          {
            detailPageUrl: {
              in: urls,
            },
          },
          {
            sourceUrl: {
              in: urls,
            },
          },
        ],
        tenantId: input.tenantId,
      },
    });

    if (vehicleByUrl) {
      return vehicleByUrl;
    }
  }

  const tokens = tokenizeInventorySearch(input.text);
  if (!tokens.length) {
    return null;
  }

  return prisma.vehicle.findFirst({
    where: {
      lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
      tenantId: input.tenantId,
      OR: tokens.flatMap((token) => [
        {
          make: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          model: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          title: {
            contains: token,
            mode: "insensitive",
          },
        },
      ]),
    },
    orderBy: {
      lastSeenAt: "desc",
    },
  });
}

async function searchInventorySuggestions(input: { tenantId: string; text: string }) {
  const tokens = tokenizeInventorySearch(input.text);
  if (!tokens.length) {
    return [];
  }

  return prisma.vehicle.findMany({
    take: 3,
    where: {
      lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
      tenantId: input.tenantId,
      OR: tokens.flatMap((token) => [
        {
          make: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          model: {
            contains: token,
            mode: "insensitive",
          },
        },
        {
          title: {
            contains: token,
            mode: "insensitive",
          },
        },
      ]),
    },
    orderBy: [{ lastSeenAt: "desc" }, { price: "asc" }],
    select: {
      detailPageUrl: true,
      id: true,
      make: true,
      mileage: true,
      model: true,
      price: true,
      title: true,
      trim: true,
      year: true,
    },
  });
}

async function upsertLeadFromMessage(input: {
  conversationId: string;
  messagingConnectionId: string;
  tenantId: string;
  text: string;
  vehicleId?: string | null;
}) {
  const email = extractEmail(input.text);
  const phone = extractPhone(input.text);

  if (!email && !phone) {
    return null;
  }

  const existingLead = await prisma.lead.findFirst({
    where: {
      conversationId: input.conversationId,
      tenantId: input.tenantId,
    },
  });

  if (existingLead) {
    return prisma.lead.update({
      where: {
        id: existingLead.id,
      },
      data: {
        email: existingLead.email ?? email ?? undefined,
        phone: existingLead.phone ?? phone ?? undefined,
        vehicleId: input.vehicleId ?? existingLead.vehicleId ?? undefined,
      },
    });
  }

  return prisma.lead.create({
    data: {
      conversationId: input.conversationId,
      email: email ?? undefined,
      messagingConnectionId: input.messagingConnectionId,
      phone: phone ?? undefined,
      tenantId: input.tenantId,
      vehicleId: input.vehicleId ?? undefined,
    },
  });
}

async function buildResponsePlan(input: {
  connection: Pick<MessagingConnection, "pageName">;
  conversation: {
    customerName: string | null;
    vehicleId: string | null;
  };
  tenantId: string;
  text: string;
}) {
  const normalizedText = normalizeMessageText(input.text);

  if (!normalizedText) {
    return {
      confidence: 0.18,
      kind: "handoff",
      reason: "The inbound message did not contain readable text.",
      replyText:
        "Thanks for reaching out. A team member is taking a closer look and will follow up shortly.",
      vehicleId: input.conversation.vehicleId,
    } satisfies ResponsePlan;
  }

  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return {
      confidence: 0.12,
      kind: "handoff",
      reason: "The message looks like financing, legal, trade-in, or sensitive account handling.",
      replyText:
        "Thanks for the message. I’m routing this to a team member so they can help directly.",
      vehicleId: input.conversation.vehicleId,
    } satisfies ResponsePlan;
  }

  const matchedVehicle = await matchVehicleFromText({
    existingVehicleId: input.conversation.vehicleId,
    tenantId: input.tenantId,
    text: normalizedText,
  });

  if (matchedVehicle) {
    return {
      confidence: 0.9,
      kind: "reply",
      replyText: buildVehicleResponse(matchedVehicle),
      vehicleId: matchedVehicle.id,
    } satisfies ResponsePlan;
  }

  const suggestions = await searchInventorySuggestions({
    tenantId: input.tenantId,
    text: normalizedText,
  });

  if (suggestions.length) {
    return {
      confidence: 0.68,
      kind: "reply",
      replyText: [
        `I found a few matches from ${input.connection.pageName || "the current inventory"}:`,
        ...suggestions.map((vehicle) =>
          `${vehicleDisplayName(vehicle)} | ${formatCurrency(vehicle.price)} | ${formatMileage(vehicle.mileage)} | ${vehicle.detailPageUrl}`,
        ),
        "If you want one of these specifically, send the stock number, VIN, or listing link and I can narrow it down.",
      ].join(" "),
      vehicleId: null,
    } satisfies ResponsePlan;
  }

  return {
    confidence: 0.44,
    kind: "reply",
    replyText:
      "I can help with availability, price, mileage, and listing details. Send the VIN, stock number, or the listing link and I’ll look it up from the live inventory workspace.",
    vehicleId: null,
  } satisfies ResponsePlan;
}

async function ensureOpenHandoffTask(input: {
  conversationId: string;
  reason: string;
  tenantId: string;
}) {
  const existingTask = await prisma.handoffTask.findFirst({
    where: {
      conversationId: input.conversationId,
      status: {
        in: [HandoffStatus.OPEN, HandoffStatus.IN_PROGRESS],
      },
      tenantId: input.tenantId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existingTask) {
    return prisma.handoffTask.update({
      where: {
        id: existingTask.id,
      },
      data: {
        notes: input.reason,
      },
    });
  }

  return prisma.handoffTask.create({
    data: {
      conversationId: input.conversationId,
      reason: input.reason,
      tenantId: input.tenantId,
    },
  });
}

export async function queueConversationResponse(input: {
  conversationId: string;
  messageId?: string | null;
  tenantId: string;
}) {
  const key = buildIdempotencyKey([input.conversationId, input.messageId ?? "latest"]);
  const reservation = await reserveIdempotencyKey({
    expiresInSeconds: 15 * 60,
    key,
    payload: input,
    scope: "conversation-response",
    tenantId: input.tenantId,
  });

  if (!reservation.isNew) {
    const existingJob = await prisma.backgroundJob.findFirst({
      where: {
        idempotencyKeyId: reservation.record.id,
        tenantId: input.tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (existingJob) {
      return existingJob;
    }

    throw new Error("A reply job for this inbound message is already queued.");
  }

  try {
    const backgroundJob = await enqueueBackgroundJob({
      idempotencyKeyId: reservation.record.id,
      payload: asJson({
        conversationId: input.conversationId,
        messageId: input.messageId ?? undefined,
      }),
      priority: JobPriority.HIGH,
      queueName: QUEUE_NAMES.conversationResponse,
      tenantId: input.tenantId,
      type: QueueJobType.CONVERSATION_RESPONSE,
    });

    await completeIdempotencyKey({
      idempotencyKeyId: reservation.record.id,
      resourceId: backgroundJob.id,
      resourceType: "BackgroundJob",
    });

    return backgroundJob;
  } catch (error) {
    await failIdempotencyKey({
      idempotencyKeyId: reservation.record.id,
      responsePayload: {
        error: error instanceof Error ? error.message : "Unable to queue conversation response.",
      },
    });
    throw error;
  }
}

export async function ingestMetaWebhookPayload(payload: MetaWebhookPayload, signature: string | null) {
  if (payload.object !== "page" || !Array.isArray(payload.entry)) {
    return {
      ignored: true,
      processedEvents: 0,
    };
  }

  let processedEvents = 0;

  for (const entry of payload.entry) {
    const pageId = entry.id;
    if (!pageId || !Array.isArray(entry.messaging) || !entry.messaging.length) {
      continue;
    }

    const connection = await findMessagingConnectionByPageId(pageId);
    if (!connection) {
      logger.warn("Ignoring webhook event for unknown Facebook Page", { pageId });
      continue;
    }

    await prisma.messagingConnection.update({
      where: {
        id: connection.id,
      },
      data: {
        lastWebhookAt: new Date(),
      },
    });

    for (const event of entry.messaging) {
      const senderId = event.sender?.id;
      const recipientId = event.recipient?.id;
      const inboundMessageText = normalizeMessageText(
        event.message?.text || event.postback?.title || event.postback?.payload,
      );
      const storedInboundMessageText = redactSensitiveText(inboundMessageText);
      const externalMessageId = event.message?.mid ?? null;
      const eventId =
        externalMessageId ??
        buildIdempotencyKey([recipientId, senderId, event.timestamp ?? entry.time ?? Date.now()]);

      const webhookEvent = await recordMessagingWebhookEvent({
        externalEventId: eventId,
        messagingConnectionId: connection.id,
        payload: redactSensitiveValue(event),
        signature,
        tenantId: connection.tenantId,
      }).catch(async (error) => {
        logger.warn("Skipping duplicate webhook event", {
          connectionId: connection.id,
          error: error instanceof Error ? error.message : String(error),
          eventId,
        });
        return null;
      });

      if (!webhookEvent) {
        continue;
      }

      if (!senderId || !recipientId) {
        await markMessagingWebhookProcessed(webhookEvent.id);
        continue;
      }

      if (event.message?.is_echo) {
        await markMessagingWebhookProcessed(webhookEvent.id);
        continue;
      }

      const conversation = await prisma.conversation.upsert({
        where: {
          messagingConnectionId_customerPsid: {
            customerPsid: senderId,
            messagingConnectionId: connection.id,
          },
        },
        create: {
          customerPsid: senderId,
          externalThreadId: senderId,
          lastInboundAt: new Date(event.timestamp ?? Date.now()),
          lastMessageAt: new Date(event.timestamp ?? Date.now()),
          messagingConnectionId: connection.id,
          tenantId: connection.tenantId,
        },
        update: {
          lastInboundAt: new Date(event.timestamp ?? Date.now()),
          lastMessageAt: new Date(event.timestamp ?? Date.now()),
          status: ConversationStatus.OPEN,
        },
      });

      const matchedVehicle = inboundMessageText
        ? await matchVehicleFromText({
            existingVehicleId: conversation.vehicleId,
            tenantId: connection.tenantId,
            text: inboundMessageText,
          })
        : null;

      const updatedConversation =
        matchedVehicle
          ? await prisma.conversation.update({
              where: {
                id: conversation.id,
              },
              data: {
                assignedToId:
                  (await getAssignedUserIdForVehicle({
                    tenantId: connection.tenantId,
                    vehicleId: matchedVehicle.id,
                  })) ?? conversation.assignedToId,
                vehicleId: matchedVehicle.id,
              },
            })
          : conversation;

      let messageRecord =
        externalMessageId
          ? await prisma.message.findFirst({
              where: {
                conversationId: updatedConversation.id,
                externalMessageId,
              },
            })
          : null;

      if (!messageRecord) {
        messageRecord = await prisma.message.create({
          data: {
            authorType: MessageAuthorType.CUSTOMER,
            conversationId: updatedConversation.id,
            direction: MessageDirection.INBOUND,
            externalMessageId: externalMessageId ?? undefined,
            payload: asJson(redactSensitiveValue(event)),
            sentAt: new Date(event.timestamp ?? Date.now()),
            tenantId: connection.tenantId,
            text: storedInboundMessageText || undefined,
          },
        });
      }

      await upsertLeadFromMessage({
        conversationId: updatedConversation.id,
        messagingConnectionId: connection.id,
        tenantId: connection.tenantId,
        text: inboundMessageText,
        vehicleId: matchedVehicle?.id ?? updatedConversation.vehicleId,
      });

      await prisma.messagingConnection.update({
        where: {
          id: connection.id,
        },
        data: {
          lastMessageAt: new Date(event.timestamp ?? Date.now()),
        },
      });

      await queueConversationResponse({
        conversationId: updatedConversation.id,
        messageId: messageRecord.id,
        tenantId: connection.tenantId,
      });

      await markMessagingWebhookProcessed(webhookEvent.id);

      processedEvents += 1;
    }
  }

  return {
    ignored: false,
    processedEvents,
  };
}

export async function executeConversationResponse(backgroundJobId: string, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: {
      id: conversationId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "desc",
        },
        take: 8,
      },
      messagingConnection: true,
      vehicle: true,
    },
  });

  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  const latestInbound = conversation.messages.find((message) => message.direction === MessageDirection.INBOUND);
  if (!latestInbound) {
    return {
      action: "ignored",
      reason: "No inbound message found.",
    };
  }

  const latestOutbound = conversation.messages.find(
    (message) => message.direction === MessageDirection.OUTBOUND,
  );

  if (latestOutbound && latestOutbound.createdAt >= latestInbound.createdAt) {
    return {
      action: "ignored",
      reason: "A newer outbound reply already exists for this conversation.",
    };
  }

  if (!conversation.aiEnabled || !conversation.messagingConnection.aiRepliesEnabled) {
    await ensureOpenHandoffTask({
      conversationId: conversation.id,
      reason: "AI replies are disabled for this conversation or Page connection.",
      tenantId: conversation.tenantId,
    });

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        handoffReason: "AI replies are disabled for this conversation or Page connection.",
        lastAiConfidence: 0,
        status: ConversationStatus.NEEDS_HUMAN,
      },
    });

    return {
      action: "handoff",
      reason: "AI replies disabled",
    };
  }

  const plan = await buildResponsePlan({
    connection: conversation.messagingConnection,
    conversation,
    tenantId: conversation.tenantId,
    text: latestInbound.text ?? "",
  });

  if (plan.kind === "handoff") {
    await ensureOpenHandoffTask({
      conversationId: conversation.id,
      reason: plan.reason,
      tenantId: conversation.tenantId,
    });

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        handoffReason: plan.reason,
        lastAiConfidence: plan.confidence,
        status: ConversationStatus.NEEDS_HUMAN,
        vehicleId: plan.vehicleId ?? undefined,
      },
    });

    let outboundMessageId: string | null = null;
    if (conversation.messagingConnection.humanHandoffEnabled) {
      const response = await sendMessengerTextReply({
        connectionId: conversation.messagingConnectionId,
        recipientPsid: conversation.customerPsid,
        text: plan.replyText,
      });

      const outboundMessage = await prisma.message.create({
        data: {
          authorType: MessageAuthorType.SYSTEM,
          conversationId: conversation.id,
          direction: MessageDirection.OUTBOUND,
          externalMessageId: response.message_id ?? undefined,
          payload: asJson(response),
          sentAt: new Date(),
          tenantId: conversation.tenantId,
          text: plan.replyText,
        },
      });

      outboundMessageId = outboundMessage.id;

      await prisma.conversation.update({
        where: {
          id: conversation.id,
        },
        data: {
          lastMessageAt: new Date(),
          lastOutboundAt: new Date(),
        },
      });
    }

    await createAuditLog({
      action: "messaging.conversation.handoff",
      entityId: conversation.id,
      entityType: "Conversation",
      metadata: asJson({
        backgroundJobId,
        confidence: plan.confidence,
        outboundMessageId,
        reason: plan.reason,
      }),
      summary: `Conversation ${conversation.id} moved to human handoff.`,
      tenantId: conversation.tenantId,
    });

    return {
      action: "handoff",
      confidence: plan.confidence,
      reason: plan.reason,
    };
  }

  const response = await sendMessengerTextReply({
    connectionId: conversation.messagingConnectionId,
    recipientPsid: conversation.customerPsid,
    text: plan.replyText,
  });

  const now = new Date();

  const outboundMessage = await prisma.message.create({
    data: {
      authorType: MessageAuthorType.BOT,
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      externalMessageId: response.message_id ?? undefined,
      payload: asJson(response),
      sentAt: now,
      tenantId: conversation.tenantId,
      text: plan.replyText,
    },
  });

  await prisma.conversation.update({
    where: {
      id: conversation.id,
    },
    data: {
      handoffReason: null,
      lastAiConfidence: plan.confidence,
      lastMessageAt: now,
      lastOutboundAt: now,
      status: ConversationStatus.OPEN,
      vehicleId: plan.vehicleId ?? undefined,
    },
  });

  await prisma.messagingConnection.update({
    where: {
      id: conversation.messagingConnectionId,
    },
    data: {
      lastMessageAt: now,
    },
  });

  await createAuditLog({
    action: "messaging.conversation.auto_replied",
    entityId: conversation.id,
    entityType: "Conversation",
    metadata: asJson({
      backgroundJobId,
      confidence: plan.confidence,
      messageId: outboundMessage.id,
    }),
    summary: `Sent an automated reply for conversation ${conversation.id}.`,
    tenantId: conversation.tenantId,
  });

  return {
    action: "replied",
    confidence: plan.confidence,
    messageId: outboundMessage.id,
  };
}

export async function getMessagingWorkspaceData(
  tenantId: string,
  viewer?: {
    role: UserRole;
    userId: string;
  },
) {
  const conversationVisibilityWhere = buildConversationViewerWhere(viewer);

  const [connections, metaAuthAccounts, recentConversations, openHandoffs] = await Promise.all([
    prisma.messagingConnection.findMany({
      where: {
        tenantId,
      },
      orderBy: [
        {
          status: "asc",
        },
        {
          updatedAt: "desc",
        },
      ],
    }),
    prisma.metaAuthAccount.findMany({
      where: {
        tenantId,
      },
      orderBy: [
        {
          status: "asc",
        },
        {
          updatedAt: "desc",
        },
      ],
    }),
      prisma.conversation.findMany({
        where: {
          ...conversationVisibilityWhere,
          tenantId,
        },
        include: {
        handoffTasks: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 3,
        },
        vehicle: {
          select: {
            id: true,
            make: true,
            model: true,
            title: true,
            trim: true,
            year: true,
          },
        },
      },
      orderBy: {
        lastMessageAt: "desc",
      },
        take: 8,
      }),
    prisma.handoffTask.count({
      where: {
        status: {
          in: [HandoffStatus.OPEN, HandoffStatus.IN_PROGRESS],
        },
        tenantId,
      },
    }),
  ]);

  const safeConnections = connections
    .map(getSafeMessagingConnectionSummary)
    .filter((connection): connection is NonNullable<ReturnType<typeof getSafeMessagingConnectionSummary>> =>
      Boolean(connection),
    );

  return {
    accounts: metaAuthAccounts.map(getSafeMetaAuthAccountSummary),
    connections: safeConnections,
    openHandoffs,
    primaryConnection: safeConnections[0] ?? null,
    recentConversations: recentConversations.map((conversation) => ({
      customerName: conversation.customerName,
      customerPsid: conversation.customerPsid,
      handoffReason: conversation.handoffReason,
      id: conversation.id,
      lastAiConfidence: conversation.lastAiConfidence,
      lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      lastMessageText: conversation.messages[0]?.text ?? null,
      messageCount: conversation.messages.length,
      status: conversation.status,
      vehicle: conversation.vehicle
        ? {
            id: conversation.vehicle.id,
            title: vehicleDisplayName(conversation.vehicle),
          }
        : null,
      latestHandoffTask: conversation.handoffTasks[0]
        ? {
            createdAt: conversation.handoffTasks[0].createdAt.toISOString(),
            id: conversation.handoffTasks[0].id,
            reason: conversation.handoffTasks[0].reason,
            status: conversation.handoffTasks[0].status,
          }
        : null,
      })),
    };
  }

export async function getConversationInboxData(input: {
  tenantId: string;
  viewerRole: UserRole;
  viewerUserId: string;
}) {
  const conversations = await prisma.conversation.findMany({
    where: {
      ...buildConversationViewerWhere({
        role: input.viewerRole,
        userId: input.viewerUserId,
      }),
      tenantId: input.tenantId,
    },
    include: {
      _count: {
        select: {
          messages: true,
        },
      },
      assignedTo: {
        select: {
          email: true,
          id: true,
          name: true,
        },
      },
      handoffTasks: {
        include: {
          assignedTo: {
            select: {
              email: true,
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
      messages: {
        orderBy: {
          sentAt: "desc",
        },
        take: 40,
      },
      messagingConnection: {
        select: {
          id: true,
          pageId: true,
          pageName: true,
          pageUsername: true,
          status: true,
        },
      },
      vehicle: {
        select: {
          id: true,
          make: true,
          model: true,
          title: true,
          trim: true,
          year: true,
        },
      },
    },
    orderBy: {
      lastMessageAt: "desc",
    },
    take: 80,
  });

  return conversations.map((conversation) => ({
    assignedTo: conversation.assignedTo
      ? {
          email: conversation.assignedTo.email,
          id: conversation.assignedTo.id,
          name: conversation.assignedTo.name,
        }
      : null,
    customerName: conversation.customerName,
    customerPsid: conversation.customerPsid,
    handoffReason: conversation.handoffReason,
    id: conversation.id,
    lastAiConfidence: conversation.lastAiConfidence,
    lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    lastOutboundAt: conversation.lastOutboundAt?.toISOString() ?? null,
    latestHandoffTask: conversation.handoffTasks[0]
      ? {
          assignedTo: conversation.handoffTasks[0].assignedTo
            ? {
                email: conversation.handoffTasks[0].assignedTo.email,
                id: conversation.handoffTasks[0].assignedTo.id,
                name: conversation.handoffTasks[0].assignedTo.name,
              }
            : null,
          createdAt: conversation.handoffTasks[0].createdAt.toISOString(),
          id: conversation.handoffTasks[0].id,
          reason: conversation.handoffTasks[0].reason,
          status: conversation.handoffTasks[0].status,
        }
      : null,
    messageCount: conversation._count.messages,
    messages: [...conversation.messages]
      .reverse()
      .map((message) => ({
        authorType: message.authorType,
        direction: message.direction,
        errorText: message.errorText,
        id: message.id,
        sentAt: message.sentAt.toISOString(),
        text: message.text,
      })),
    page: {
      id: conversation.messagingConnection.id,
      name: conversation.messagingConnection.pageName,
      status: conversation.messagingConnection.status,
      username: conversation.messagingConnection.pageUsername,
    },
    status: conversation.status,
    vehicle: conversation.vehicle
      ? {
          id: conversation.vehicle.id,
          title: vehicleDisplayName(conversation.vehicle),
        }
      : null,
  }));
}
