import { match } from 'ts-pattern';
import type { MessageParent } from '../../../generated/storage/types.gen';
import { Channel } from '../../entities/channels/channel';
import { Message } from '../../entities/channels/message';
import { Thread } from '../../entities/channels/thread';
import { Comment } from '../../entities/documents/comment';
import { Document } from '../../entities/documents/document';
import type { SimpleMention } from '../../mentions';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';
import { userFromPrincipal } from './channel';

export type MessageEvent = Extract<
  MacroEvent,
  { event_type: `message.${string}` }
>;

/**
 * The entity a message event belongs to. Channel messages hydrate a `Channel`,
 * a `Message`, and the `Thread` for replies; document comments hydrate a
 * `Document` and a `Comment`. Both handles share `reply`, `edit`, `delete`,
 * `author`, and `content`/`text` reads.
 */
export type MessageEventTarget =
  | {
      type: 'channel';
      channel: Channel;
      message: Message;
      /** Set for replies: the thread the message belongs to. */
      thread: Thread | undefined;
    }
  | {
      type: 'document';
      document: Document;
      comment: Comment;
      /** The root of the comment's thread. */
      threadId: string;
    };

function target(
  client: MacroClient,
  metadata: {
    parent: MessageParent;
    message_id: string;
    thread_id?: string | null;
    root_id: string;
  },
  mentions: SimpleMention[] = [],
): MessageEventTarget {
  const parent = metadata.parent;
  if (parent.type === 'channel') {
    return {
      type: 'channel',
      channel: Channel.byId(client, parent.id),
      message: Message.byId(client, parent.id, metadata.message_id, mentions),
      thread: metadata.thread_id
        ? new Thread(client, parent.id, metadata.thread_id)
        : undefined,
    };
  }
  return {
    type: 'document',
    document: Document.byId(client, parent.id),
    comment: Comment.byId(client, parent.id, metadata.message_id),
    threadId: metadata.root_id,
  };
}

/** Attach SDK entity handles to a message webhook event. */
export function hydrateMessageEvent(client: MacroClient, event: MessageEvent) {
  return match(event)
    .with({ event_type: 'message.posted' }, ({ metadata }) => ({
      event_type: 'message.posted' as const,
      metadata,
      target: target(client, metadata, metadata.mentions),
      sender: userFromPrincipal(client, metadata.sender),
    }))
    .with({ event_type: 'message.mentioned' }, ({ metadata }) => ({
      event_type: 'message.mentioned' as const,
      metadata,
      target: target(client, metadata),
      sender: userFromPrincipal(client, metadata.sender),
    }))
    .with({ event_type: 'message.patched' }, ({ metadata }) => ({
      event_type: 'message.patched' as const,
      metadata,
      target: target(client, metadata),
      actor: userFromPrincipal(client, metadata.actor),
    }))
    .with({ event_type: 'message.deleted' }, ({ metadata }) => ({
      event_type: 'message.deleted' as const,
      metadata,
      target: target(client, metadata),
      actor: userFromPrincipal(client, metadata.actor),
    }))
    .with({ event_type: 'message.attachment_created' }, ({ metadata }) => ({
      event_type: 'message.attachment_created' as const,
      metadata,
      target: target(client, metadata),
      actor: userFromPrincipal(client, metadata.actor),
    }))
    .with({ event_type: 'message.attachment_removed' }, ({ metadata }) => ({
      event_type: 'message.attachment_removed' as const,
      metadata,
      target: target(client, metadata),
      actor: userFromPrincipal(client, metadata.actor),
    }))
    .exhaustive();
}
