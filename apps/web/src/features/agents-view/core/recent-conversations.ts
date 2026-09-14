import type { AgentSessionEntity, ChatEntity, EntityData } from '@entity';

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

function timestamp(entity: AgentConversationEntity): number {
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
    .toSorted((left, right) => timestamp(right) - timestamp(left));
}
