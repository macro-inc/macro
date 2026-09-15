import type { AgentSessionEntity, ChatEntity, EntityData } from '@entity';
import type { AgentKind } from './agent-kind';
import { conversationState } from './conversation-state';
import type { AgentsMode } from './mode';

export type AgentConversationEntity = AgentSessionEntity | ChatEntity;
export type AgentConversationTarget = Pick<
  AgentConversationEntity,
  'id' | 'type'
>;

function isAgentConversation(
  entity: EntityData
): entity is AgentConversationEntity {
  return entity.type === 'agent_session' || entity.type === 'chat';
}

/** When a conversation last moved, as epoch millis; 0 when unknown. */
export function conversationTimestamp(
  entity: Pick<AgentConversationEntity, 'updatedAt' | 'createdAt'>
): number {
  const value = entity.updatedAt ?? entity.createdAt;
  if (!value) return 0;

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Select the current user's agent conversations, newest first. */
export function selectRecentAgentConversations(
  entities: EntityData[],
  ownerId: string | undefined,
  search: string
): AgentConversationEntity[] {
  if (!ownerId) return [];

  const query = search.trim().toLocaleLowerCase();

  return entities
    .filter(isAgentConversation)
    .filter((entity) => entity.ownerId === ownerId)
    .filter(
      (entity) =>
        !query ||
        (entity.name || 'Untitled chat').toLocaleLowerCase().includes(query)
    )
    .toSorted(
      (left, right) =>
        conversationTimestamp(right) - conversationTimestamp(left)
    );
}

/** Names the bot behind a session. Plain chats are always Macro's. */
export type ConversationKindResolver = (botId: string | undefined) => AgentKind;

/**
 * The conversations a mode shows: Chat keeps plain chats and sessions with
 * chat agents, Code keeps sessions with coders.
 */
export function conversationsForMode(
  conversations: readonly AgentConversationEntity[],
  mode: AgentsMode,
  kindOf: ConversationKindResolver
): AgentConversationEntity[] {
  return conversations.filter((conversation) => {
    if (conversation.type === 'chat') return mode === 'chat';
    const kind = kindOf(conversation.bot?.id ?? conversation.botId);
    return mode === 'code' ? kind === 'coder' : kind === 'agent';
  });
}

export type ConversationGroupId = 'recent' | 'active' | 'past';

export type ConversationGroup = {
  id: ConversationGroupId;
  /** Absent for a lone group that needs no heading. */
  label: string | undefined;
  conversations: AgentConversationEntity[];
};

/**
 * How the list is sectioned. Chat is one flat list, newest first. Code splits
 * sessions whose runtime is still up (starting or ready) from the ones whose
 * runtime has gone, so live work stays at the top.
 */
export function groupConversations(
  conversations: readonly AgentConversationEntity[],
  mode: AgentsMode
): ConversationGroup[] {
  if (conversations.length === 0) return [];
  if (mode === 'chat') {
    return [
      { id: 'recent', label: undefined, conversations: [...conversations] },
    ];
  }

  const active: AgentConversationEntity[] = [];
  const past: AgentConversationEntity[] = [];
  for (const conversation of conversations) {
    const live =
      conversation.type === 'agent_session' &&
      conversationState(conversation.status) !== 'ended';
    (live ? active : past).push(conversation);
  }

  const groups: ConversationGroup[] = [];
  if (active.length)
    groups.push({ id: 'active', label: 'Active', conversations: active });
  if (past.length)
    groups.push({ id: 'past', label: 'Past', conversations: past });
  return groups;
}

export type BotUsage = {
  /** Sessions in the loaded list that ran as this bot. */
  sessions: number;
  /** When the newest of them last moved, as epoch millis. */
  lastUsedAt: number;
};

/** Per-bot usage from the loaded sessions, for the coder cards' footers. */
export function botUsage(
  conversations: readonly AgentConversationEntity[]
): Map<string, BotUsage> {
  const usage = new Map<string, BotUsage>();
  for (const conversation of conversations) {
    if (conversation.type !== 'agent_session') continue;
    const botId = conversation.bot?.id ?? conversation.botId;
    const current = usage.get(botId) ?? { sessions: 0, lastUsedAt: 0 };
    usage.set(botId, {
      sessions: current.sessions + 1,
      lastUsedAt: Math.max(
        current.lastUsedAt,
        conversationTimestamp(conversation)
      ),
    });
  }
  return usage;
}
