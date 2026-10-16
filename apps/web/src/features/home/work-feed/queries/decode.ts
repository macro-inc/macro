import type { UnifiedNotification } from '@notifications/types';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import type {
  WorkFeedItemState as GraphqlWorkFeedItemState,
  WorkFeedItemType as GraphqlWorkFeedItemType,
  WorkFeedEntryFieldsFragment,
  WorkFeedScopeInput,
} from '@service-storage/graphql/generated/graphql';
import {
  type GraphqlSoupItem,
  mapGraphqlNotification,
  mapGraphqlSoupItem,
} from '@service-storage/graphql-soup';
import { match } from 'ts-pattern';
import type {
  WorkFeedEntry,
  WorkFeedItemState,
  WorkFeedItemType,
  WorkFeedScope,
} from '../core/work-feed';

const decodeState = (state: GraphqlWorkFeedItemState): WorkFeedItemState =>
  match(state)
    .with('UNSEEN', () => 'unseen' as const)
    .with('SEEN', () => 'seen' as const)
    .with('DONE', () => 'done' as const)
    .exhaustive();

const toTimestamp = (value: string | null | undefined) =>
  value ? new Date(value).getTime() : undefined;

/** Every notification the item's stacks carry, newest first, once each. */
function stackNotifications(
  item: WorkFeedEntryFieldsFragment['item']
): UnifiedNotification[] {
  const seen = new Set<string>();
  const notifications: UnifiedNotification[] = [];
  for (const stack of item.stacks) {
    for (const notification of stack.notifications) {
      if (seen.has(notification.id)) continue;
      seen.add(notification.id);
      notifications.push(mapGraphqlNotification(notification));
    }
  }
  return notifications.sort(
    (a, b) =>
      (toTimestamp(b.created_at) ?? 0) - (toTimestamp(a.created_at) ?? 0)
  );
}

/**
 * Decode one GraphQL entry into a Home row entity. The entity carries the
 * item's own scoped notifications — a channel row never borrows its threads'
 * — and Home's timestamps: `sortTs` places the row, `notifiedAt` and
 * `touchedAt` are its two reasons.
 */
export function decodeWorkFeedEntry(
  entry: WorkFeedEntryFieldsFragment
): WorkFeedEntry | null {
  const { item } = entry;
  const notifications = stackNotifications(item);
  // The stacks replace the entity's own notification edge, which would
  // read every notification of a channel, including its threads'.
  const soupItem = mapGraphqlSoupItem({
    ...item.entity,
    notifications: [],
  } as GraphqlSoupItem);
  if (!soupItem || !isDisplayableSoupItem(soupItem)) return null;

  const sortAt = toTimestamp(entry.sortAt);
  if (sortAt === undefined) return null;
  const entity = mapApiSoupItemToEntity({
    ...soupItem,
    notified_at: item.attentionAt,
    touched_at: entry.touchedAt,
  });
  const primaryReason =
    entry.primaryReason === 'ATTENTION' ? 'attention' : 'own_work';

  return {
    itemId: item.id,
    revision: entry.revision,
    sortAt,
    state: decodeState(item.state),
    primaryReason,
    hasAttention: item.attentionAt !== null,
    hasOwnWork: entry.touchedAt !== null,
    entity: {
      ...entity,
      notifications,
      sortTs: entry.sortAt,
      // A row presents the newest attention only while it is the primary
      // reason; newer own work keeps an older comment's label off the row.
      notificationDisplayCutoff:
        primaryReason === 'attention' ? item.attentionAt : entry.touchedAt,
    },
  };
}

const toGraphqlItemType = (type: WorkFeedItemType): GraphqlWorkFeedItemType =>
  match(type)
    .with('document', () => 'DOCUMENT' as const)
    .with('chat', () => 'CHAT' as const)
    .with('project', () => 'PROJECT' as const)
    .with('email', () => 'EMAIL' as const)
    .with('channel', () => 'CHANNEL' as const)
    .with('channel_thread', () => 'CHANNEL_THREAD' as const)
    .with('calendar_event', () => 'CALENDAR_EVENT' as const)
    .with('pull_request', () => 'PULL_REQUEST' as const)
    .with('agent_session', () => 'AGENT_SESSION' as const)
    .exhaustive();

/** Encode a feed scope for the wire. */
export function encodeWorkFeedScope(scope: WorkFeedScope): WorkFeedScopeInput {
  return {
    mode: scope.mode === 'work' ? 'WORK' : 'ATTENTION',
    types: scope.types.map(toGraphqlItemType),
    includeSnippets: scope.includeSnippets,
  };
}
