import type { UnifiedNotification } from '@notifications/types';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import type {
  GraphqlEntityType,
  NotificationEntityInput,
  NotificationUpdateOperation,
} from '@service-storage/graphql/generated/graphql';
import { updateNotificationsForEntities as updateGraphqlNotificationsForEntities } from '@service-storage/graphql-notifications';
import {
  graphqlCacheEnabled,
  mapGraphqlNotification,
} from '@service-storage/graphql-soup';

type SimpleNotificationEntityType =
  | 'calendar_event'
  | 'call'
  | 'channel'
  | 'chat'
  | 'crm_company'
  | 'document'
  | 'email'
  | 'email_thread'
  | 'foreign'
  | 'foreign_entity'
  | 'project'
  | 'reminder';

/**
 * Frontend entity reference accepted by entity-scoped notification writes.
 * Channel message/thread targets require the canonical message id because a
 * search-result entity's generic `id` may include its channel id.
 */
export type NotificationEntityRef =
  | { type: SimpleNotificationEntityType; id: string }
  | {
      type: 'channel_message' | 'channel_thread';
      id: string;
      messageId: string;
    };

type FrontendNotificationEntity = {
  type: string;
  id: string;
  messageId?: string;
};

/** Return a supported, canonical entity-mutation target when one exists. */
export function toNotificationEntityRef(
  entity: FrontendNotificationEntity
): NotificationEntityRef | undefined {
  switch (entity.type) {
    case 'calendar_event':
    case 'call':
    case 'channel':
    case 'chat':
    case 'crm_company':
    case 'document':
    case 'email':
    case 'email_thread':
    case 'foreign':
    case 'foreign_entity':
    case 'project':
    case 'reminder':
      return { type: entity.type, id: entity.id };
    case 'channel_message':
    case 'channel_thread':
      return entity.messageId
        ? { type: entity.type, id: entity.id, messageId: entity.messageId }
        : undefined;
    default:
      return undefined;
  }
}

/** Entity-wide operations. Undo intentionally remains notification-ID scoped. */
export type NotificationEntityUpdateOperation = Exclude<
  NotificationUpdateOperation,
  'MARK_UNDONE'
>;

const ENTITY_TYPE_TO_GRAPHQL = {
  calendar_event: 'CALENDAR_EVENT',
  call: 'CALL',
  channel: 'CHANNEL',
  chat: 'CHAT',
  crm_company: 'CRM_COMPANY',
  document: 'DOCUMENT',
  email: 'EMAIL_THREAD',
  email_thread: 'EMAIL_THREAD',
  foreign: 'FOREIGN_ENTITY',
  foreign_entity: 'FOREIGN_ENTITY',
  project: 'PROJECT',
  reminder: 'REMINDER',
} as const satisfies Record<SimpleNotificationEntityType, GraphqlEntityType>;

/** Convert a frontend entity reference into the canonical GraphQL input. */
export function toNotificationEntityInput(
  entity: NotificationEntityRef
): NotificationEntityInput {
  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return {
      entityType: 'CHANNEL_MESSAGE',
      entityId: entity.messageId,
    };
  }

  return {
    entityType: ENTITY_TYPE_TO_GRAPHQL[entity.type],
    entityId: entity.id,
  };
}

/**
 * Mark all notifications associated with the supplied entities seen or done.
 * The authoritative response updates the normalized GraphQL cache directly;
 * it is deliberately not mirrored into the legacy TanStack notification cache.
 * Returned rows include the exact IDs needed by a later ID-scoped undo.
 */
export async function updateNotificationsForEntities(args: {
  entities: NotificationEntityRef[];
  operation: NotificationEntityUpdateOperation;
}): Promise<UnifiedNotification[]> {
  if (args.entities.length === 0) return [];

  const rows = await updateGraphqlNotificationsForEntities({
    entities: args.entities.map(toNotificationEntityInput),
    operation: args.operation,
  });
  if (!graphqlCacheEnabled()) {
    await refreshActiveGraphqlSoupQueries();
  }
  return rows.map((row) => mapGraphqlNotification(row));
}
