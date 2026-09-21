import type { AgentSessionEntity, ChatEntity, EntityData } from '@entity';
import { type AgentKind, modeForKind } from './agent-kind';
import type { AgentsMode } from './mode';

export type AgentConversationEntity = AgentSessionEntity | ChatEntity;

/** The persona a conversation runs, when the entity says. Chats have none. */
export function conversationBotId(
  conversation: AgentConversationEntity
): string | undefined {
  if (conversation.type !== 'agent_session') return undefined;
  return conversation.bot?.id ?? conversation.botId;
}
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

/** Resolve navigation from the conversation itself, independent of composer mode. */
export function conversationMode(
  conversation: AgentConversationEntity,
  kindOf: ConversationKindResolver
): AgentsMode {
  return conversation.type === 'chat'
    ? 'chat'
    : modeForKind(kindOf(conversationBotId(conversation)));
}

type ConversationGroupId = 'recent';

export type ConversationGroup = {
  id: ConversationGroupId;
  /** Absent for a lone group that needs no heading. */
  label: string | undefined;
  conversations: AgentConversationEntity[];
};

/** One mixed list, retaining the query's newest-first order. */
export function groupConversations(
  conversations: readonly AgentConversationEntity[]
): ConversationGroup[] {
  return conversations.length
    ? [{ id: 'recent', label: undefined, conversations: [...conversations] }]
    : [];
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
    const botId = conversationBotId(conversation);
    if (!botId) continue;
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
