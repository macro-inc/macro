import type { ConversationFacts } from './conversation-filters';
import { sortConversations } from './conversation-list';
import type { AgentConversationEntity } from './recent-conversations';
import type { RosterAgent } from './roster';

/** Only loaded rows participate; the identity includes the entity type. */
export function partitionPhoneConversations<
  Item extends AgentConversationEntity,
>(
  rows: readonly Item[],
  favorites: ReadonlySet<string>,
  factsOf: (row: Item) => ConversationFacts
) {
  const waiting: Item[] = [];
  const pinned: Item[] = [];
  const conversations: Item[] = [];
  for (const row of sortConversations(rows, 'updated')) {
    if (factsOf(row).state === 'waiting') waiting.push(row);
    else if (favorites.has(`${row.type}:${row.id}`)) pinned.push(row);
    else conversations.push(row);
  }
  return { waiting, favorites: pinned, conversations };
}

export function startableCustomAgents(roster: readonly RosterAgent[]) {
  return roster.filter(
    (agent) => agent.share !== 'system' && !agent.unavailableReason
  );
}
