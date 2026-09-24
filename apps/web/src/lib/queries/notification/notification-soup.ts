import { channelThreadRootId } from '@notifications/channel-thread-root';
import type { UnifiedNotification } from '@notifications/types';
import { match, P } from 'ts-pattern';
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
    .with('reminder', () => 'reminder' as const)
    .with('calendar_event', () => 'calendarEvent' as const)
    .with('agent_session', () => 'agentSession' as const)
    .with(
      P.union(
        'user',
        'team',
        'call',
        'channel_message',
        'static_file',
        'crm_company',
        'crm_contact',
        'skill',
        'scheduled_action',
        'initiative'
      ),
      () => null
    )
    .exhaustive();
}

/** Keep REST-backed Home rows live even when notifications use GraphQL. */
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
    void refetchSoupEntity(notification.entity_id, soupTag);
  }

  // Mentions and replies belong to the thread's Home row, not the channel's.
  // The floor also protects against older pages that are already in flight.
  const threadRootId = channelThreadRootId(notification);
  if (notification.created_at) {
    bumpSoupEntityNotifiedAt(
      threadRootId ?? notification.entity_id,
      notification.created_at
    );
  }
  if (threadRootId && !hasSoupEntity(threadRootId)) {
    void refetchSoupEntity(threadRootId, 'channelThread');
  }

  // A field merge cannot restore a cached row removed by a done filter.
  if (notification.state !== 'done') {
    restoreSoupEntityToDoneFilteredQueries(
      threadRootId ?? notification.entity_id,
      notification.state
    );
  }
}
