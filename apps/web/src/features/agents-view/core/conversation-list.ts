import type { ConversationFacts } from './conversation-filters';
import type { AgentConversationEntity } from './recent-conversations';

export type ConversationSort = 'updated' | 'created';

/** The selected ordering key as epoch millis; invalid or missing dates sort last. */
export function sortConversationTimestamp(
  entity: Pick<AgentConversationEntity, 'updatedAt' | 'createdAt'>,
  sort: ConversationSort
): number {
  const value =
    sort === 'updated'
      ? (entity.updatedAt ?? entity.createdAt)
      : entity.createdAt;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Return a new newest-first list without mutating the query's rows. */
export function sortConversations<
  Item extends Pick<AgentConversationEntity, 'updatedAt' | 'createdAt'>,
>(items: readonly Item[], sort: ConversationSort): Item[] {
  return items.toSorted(
    (left, right) =>
      sortConversationTimestamp(right, sort) -
      sortConversationTimestamp(left, sort)
  );
}

/** Waiting takes precedence over every other active-list section. */
export function partitionWaitingConversations<Item>(
  items: readonly Item[],
  factsOf: (item: Item) => ConversationFacts
): { waiting: Item[]; conversations: Item[] } {
  const waiting: Item[] = [];
  const conversations: Item[] = [];
  for (const item of items) {
    if (factsOf(item).state === 'waiting') waiting.push(item);
    else conversations.push(item);
  }
  return { waiting, conversations };
}
