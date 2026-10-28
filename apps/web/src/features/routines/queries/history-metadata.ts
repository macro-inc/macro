import { useAgentSessionQuery } from '@queries/agent-session/session';
import { useChatQuery } from '@queries/chat';
import type { Accessor } from 'solid-js';
import type { HistoryMetadata } from '../context/history';
export function createChatHistoryMetadata(
  id: string
): Accessor<HistoryMetadata> {
  const query = useChatQuery(() => id);
  return () => {
    if (query.isPending) return { status: 'pending' };
    if (!query.isSuccess) return { status: 'unavailable' };
    const chat = query.data?.chat;
    return chat
      ? {
          status: 'ready',
          entity: {
            type: 'chat',
            id,
            name: chat.name,
            ownerId: chat.userId,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            model: chat.model,
          },
        }
      : { status: 'unavailable' };
  };
}

export function createAgentHistoryMetadata(
  id: string
): Accessor<HistoryMetadata> {
  const query = useAgentSessionQuery(() => id);
  return () => {
    if (query.isPending) return { status: 'pending' };
    if (!query.isSuccess) return { status: 'unavailable' };
    const session = query.data;
    return session
      ? {
          status: 'ready',
          entity: {
            type: 'agent_session',
            id,
            name: session.name,
            ownerId: session.ownerId,
            botId: session.botId,
            harness: session.harness,
            isArchived: session.isArchived,
            createdAt: session.createdAt,
            updatedAt: session.modifiedAt,
            status:
              session.status.kind === 'event'
                ? session.status.event
                : session.status.kind,
          },
        }
      : { status: 'unavailable' };
  };
}
