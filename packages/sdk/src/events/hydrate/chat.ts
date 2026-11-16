import { match } from 'ts-pattern';
import { Chat } from '../../entities/chats/chat';
import { Project } from '../../entities/projects/project';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type ChatEvent = Extract<MacroEvent, { event_type: `chat.${string}` }>;

/** Attach chat, project and actor handles to a chat event. */
export function hydrateChatEvent(client: MacroClient, event: ChatEvent) {
  const actor = (id: string | null | undefined) =>
    id ? User.byId(client, id) : undefined;

  return match(event)
    .with({ event_type: 'chat.created' }, ({ metadata }) => ({
      event_type: 'chat.created' as const,
      metadata,
      chat: Chat.byId(client, metadata.chat_id),
      project: metadata.project_id
        ? Project.byId(client, metadata.project_id)
        : undefined,
    }))
    .with({ event_type: 'chat.updated' }, ({ metadata }) => ({
      event_type: 'chat.updated' as const,
      metadata,
      chat: Chat.byId(client, metadata.chat_id),
      actor: User.byId(client, metadata.actor_user_id),
    }))
    .with(
      { event_type: 'chat.deleted' },
      { event_type: 'chat.restored' },
      ({ event_type, metadata }) => ({
        event_type,
        metadata,
        chat: Chat.byId(client, metadata.chat_id),
        actor: actor(metadata.actor_user_id),
      }),
    )
    .with({ event_type: 'chat.copied' }, ({ metadata }) => ({
      event_type: 'chat.copied' as const,
      metadata,
      chat: Chat.byId(client, metadata.chat_id),
      sourceChat: Chat.byId(client, metadata.source_chat_id),
    }))
    .with({ event_type: 'chat.message_sent' }, ({ metadata }) => ({
      event_type: 'chat.message_sent' as const,
      metadata,
      chat: Chat.byId(client, metadata.chat_id),
      actor: actor(metadata.actor_user_id),
    }))
    .with({ event_type: 'chat.message_deleted' }, ({ metadata }) => ({
      event_type: 'chat.message_deleted' as const,
      metadata,
      chat: Chat.byId(client, metadata.chat_id),
    }))
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown chat event', unknown);
      return undefined;
    });
}
