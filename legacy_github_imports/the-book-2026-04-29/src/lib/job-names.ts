export const QUEUE_NAMES = {
  inventory: "inventory",
  listings: "listings",
  conversations: "conversations",
  notifications: "notifications",
} as const;

export const JOB_NAMES = {
  inventorySyncRequested: "inventory.sync.requested",
  inventoryNormalizeBatch: "inventory.normalize.batch",
  inventoryVehicleUpsert: "inventory.vehicle.upsert",
  listingAssignmentRequested: "listing.assignment.requested",
  listingDraftGenerate: "listing.draft.generate",
  listingPublishAttempt: "listing.publish.attempt",
  listingRetrySchedule: "listing.retry.schedule",
  listingStaleCleanup: "listing.stale.cleanup",
  conversationSyncRequested: "conversation.sync.requested",
  conversationUnreadRefresh: "conversation.unread.refresh",
  notificationDispatch: "notification.dispatch",
} as const;

export const JOB_NAME_LIST = Object.values(JOB_NAMES);
