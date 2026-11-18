import { fireAndForget } from '@core/util/fireAndForget';
import { channelThreadRootId } from '@notifications/channel-thread-root';
import type { UnifiedNotification } from '@notifications/types';
import { match, P } from 'ts-pattern';
import { refreshActiveGraphqlSoupQueries } from '../soup/graphql/active-queries';
import {
  bumpSoupEntityNotifiedAt,
  hasSoupEntity,
  optimisticUpdateSoupItemUpdatedAt,
  refetchSoupEntity,
  restoreSoupEntityToDoneFilteredQueries,
  type SoupEntityTag,
} from '../soup/normalized-cache';

function notificationEntityTypeToSoupTag(
  entityType: UnifiedNotification['entity_type']
): SoupEntityTag | null {
  return match(entityType)
    .with('document', () => 'document' as const)
    .with('chat', () => 'chat' as const)
    .with('channel', () => 'channel' as const)
    .with('project', () => 'project' as const)
    .with('email_thread', () => 'emailThread' as const)
    .with('foreign_entity', () => 'foreignEntity' as const)
    .with('calendar_event', () => 'calendarEvent' as const)
    .with('agent_session', () => 'agentSession' as const)
    .with(
      P.union(
        'user',
        'reminder',
        'team',
        'call',
        'channel_message',
        'static_file',
        'crm_company',
        'crm_contact',
        'crm_pipeline',
        'skill',
        'database',
        'database_row',
        'form',
        'scheduled_action',
        'initiative',
        'external_chat',
        'harness'
      ),
      () => null
    )
    .exhaustive(() => null);
}

/** Keep Home rows live, on REST and GraphQL lists alike. */
export function updateSoupForNotification(notification: UnifiedNotification) {
  const soupTag = notificationEntityTypeToSoupTag(notification.entity_type);
  if (!soupTag) return;

  if (hasSoupEntity(notification.entity_id)) {
    if (notification.created_at) {
      optimisticUpdateSoupItemUpdatedAt(
        notification.entity_id,
        soupTag,
        notification.created_at
      );
    }
  } else {
    fireAndForget(
      refetchSoupEntity(notification.entity_id, soupTag, { notified: true }),
      'notification-soup'
    );
  }

  // Mentions, replies, and reactions belong to the thread's Home row.
  // The floor also protects against older pages that are already in flight.
  const threadRootId = channelThreadRootId(notification);
  if (notification.created_at) {
    bumpSoupEntityNotifiedAt(
      threadRootId ?? notification.entity_id,
      notification.created_at
    );
  }
  if (threadRootId && !hasSoupEntity(threadRootId)) {
    fireAndForget(
      refetchSoupEntity(threadRootId, 'channelThread', { notified: true }),
      'notification-soup'
    );
  }

  // A field merge cannot restore a cached row removed by a done filter.
  if (notification.state !== 'done') {
    restoreSoupEntityToDoneFilteredQueries(
      threadRootId ?? notification.entity_id,
      notification.state
    );
  }

  revalidateNotifiedGraphqlSoupLists();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Whether a mounted Soup list's REST-shaped request is ordered by notification. */
function isNotifiedList(body: unknown): boolean {
  if (!isRecord(body) || !isRecord(body.params)) return false;
  return body.params.sort_method === 'notified_at';
}

/**
 * GraphQL lists ordered by notification have no local projection: the cache
 * can neither place a newly notified entity in them nor move a row up. They
 * read their loaded pages again instead, which carries the new stamps.
 */
function revalidateNotifiedGraphqlSoupLists(): void {
  fireAndForget(
    refreshActiveGraphqlSoupQueries({ where: isNotifiedList }),
    'notification-soup'
  );
}
