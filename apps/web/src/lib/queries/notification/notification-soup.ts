import { debounce } from '@core/util/debounce';
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
import {
  ACCOUNT_WIDE_REFRESH_INTERVAL_MS,
  createVisibleRefresh,
} from '../visible-refresh';

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
  // Before the tag check: a re-read needs no tag, and Home lists kinds the
  // REST normalizer has none for (projects).
  revalidateNotifiedGraphqlSoupLists();

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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether a mounted Soup list is a notified list. Grouped ones count too:
 * they sort each group by update time, but which rows they hold and the
 * notification times on them still change with each new notification, which
 * REST grouped lists follow (the entity refetch patches or reloads them).
 */
function isNotifiedList(body: unknown): boolean {
  if (!isRecord(body) || !isRecord(body.params)) return false;
  return body.params.sort_method === 'notified_at';
}

/** Soup lists read a replica, which can answer the first re-read without the
 * notification; a second read this long after the last one catches it. */
const REPLICA_LAG_REREAD_DELAY_MS = 3000;

let notifiedListReread: ReturnType<typeof createVisibleRefresh> | undefined;

/** Created on first use, so importing this module adds no listener. */
function notifiedListRereader() {
  notifiedListReread ??= createVisibleRefresh(
    () => refreshActiveGraphqlSoupQueries({ where: isNotifiedList }),
    { intervalMs: ACCOUNT_WIDE_REFRESH_INTERVAL_MS }
  );
  return notifiedListReread;
}

const rereadAfterReplicaLag = debounce(
  () => notifiedListRereader().markDirty(),
  REPLICA_LAG_REREAD_DELAY_MS
);

/**
 * GraphQL lists ordered by notification have no local projection: the cache
 * can neither place a newly notified entity in them nor move a row up, and
 * the notified-at floor only applies when a row is mapped again. Grouped
 * notified lists project by update time, which a notification leaves alone.
 * They read their loaded pages again instead, which carries the new stamps.
 * A flat list's read runs the notified page query, whose cost grows with the
 * viewer's notifications, for every loaded page; a grouped list's runs the
 * grouped query by update time for its first page and each loaded
 * continuation page, as every write to it already does. A notification marks
 * the lists for a read, and so does the replica lag timer after the last one;
 * a read starts at once unless one started within the interval or is still
 * running, and then after it. A hidden tab keeps the mark and reads when shown.
 */
function revalidateNotifiedGraphqlSoupLists(): void {
  notifiedListRereader().markDirty();
  rereadAfterReplicaLag();
}
