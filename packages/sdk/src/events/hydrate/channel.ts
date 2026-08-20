import { match } from 'ts-pattern';
import { Channel } from '../../entities/channels/channel';
import { Message } from '../../entities/channels/message';
import { Thread } from '../../entities/channels/thread';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type ChannelEvent = Extract<
  MacroEvent,
  { event_type: `channel.${string}` }
>;

/** Wire prefix on a user principal; bots instead arrive as `bot|<uuid>`. */
const USER_PREFIX = 'macro|';

/**
 * Resolve a channel principal to a user handle, or undefined when it names a
 * bot. Lower-cased to match how the backend stores ids. Note `|` is legal in an
 * email, so `macro|bot|a@b.com` is a user.
 */
export function userFromPrincipal(client: MacroClient, principalId: string) {
  return principalId.startsWith(USER_PREFIX) &&
    principalId.length > USER_PREFIX.length
    ? User.byId(client, principalId.toLowerCase())
    : undefined;
}

/** Attach SDK entity handles to a channel webhook event. */
export function hydrateChannelEvent(client: MacroClient, event: ChannelEvent) {
  return match(event)
    .with({ event_type: 'channel.created' }, ({ metadata }) => ({
      event_type: 'channel.created' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      actor: userFromPrincipal(client, metadata.actor),
      participants: metadata.participant_user_ids.map((userId) =>
        User.byId(client, userId),
      ),
    }))
    .with({ event_type: 'channel.updated' }, ({ metadata }) => ({
      event_type: 'channel.updated' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      actor: userFromPrincipal(client, metadata.actor),
    }))
    .with({ event_type: 'channel.deleted' }, ({ metadata }) => ({
      event_type: 'channel.deleted' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      actor: userFromPrincipal(client, metadata.actor),
    }))
    .with({ event_type: 'channel.message_posted' }, ({ metadata }) => ({
      event_type: 'channel.message_posted' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      message: Message.byId(
        client,
        metadata.channel_id,
        metadata.message_id,
        metadata.mentions,
      ),
      sender: userFromPrincipal(client, metadata.sender),
      thread: metadata.thread_id
        ? new Thread(client, metadata.channel_id, metadata.thread_id)
        : undefined,
    }))
    .with({ event_type: 'channel.mentioned' }, ({ metadata }) => ({
      event_type: 'channel.mentioned' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      message: Message.byId(
        client,
        metadata.channel_id,
        metadata.message_id,
        [],
      ),
      sender: userFromPrincipal(client, metadata.sender),
      thread: metadata.thread_id
        ? new Thread(client, metadata.channel_id, metadata.thread_id)
        : undefined,
    }))
    .with({ event_type: 'channel.message_patched' }, ({ metadata }) => ({
      event_type: 'channel.message_patched' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      message: Message.byId(
        client,
        metadata.channel_id,
        metadata.message_id,
        [],
      ),
      actor: userFromPrincipal(client, metadata.actor),
      thread: metadata.thread_id
        ? new Thread(client, metadata.channel_id, metadata.thread_id)
        : undefined,
    }))
    .with({ event_type: 'channel.message_deleted' }, ({ metadata }) => ({
      event_type: 'channel.message_deleted' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      message: Message.byId(
        client,
        metadata.channel_id,
        metadata.message_id,
        [],
      ),
      actor: userFromPrincipal(client, metadata.actor),
      thread: metadata.thread_id
        ? new Thread(client, metadata.channel_id, metadata.thread_id)
        : undefined,
    }))
    .with(
      { event_type: 'channel.message_attachment_created' },
      ({ metadata }) => ({
        event_type: 'channel.message_attachment_created' as const,
        metadata,
        channel: Channel.byId(client, metadata.channel_id),
        message: Message.byId(
          client,
          metadata.channel_id,
          metadata.message_id,
          [],
        ),
        actor: userFromPrincipal(client, metadata.actor),
      }),
    )
    .with(
      { event_type: 'channel.message_attachment_removed' },
      ({ metadata }) => ({
        event_type: 'channel.message_attachment_removed' as const,
        metadata,
        channel: Channel.byId(client, metadata.channel_id),
        message: Message.byId(
          client,
          metadata.channel_id,
          metadata.message_id,
          [],
        ),
        actor: userFromPrincipal(client, metadata.actor),
      }),
    )
    .with({ event_type: 'channel.participant_added' }, ({ metadata }) => ({
      event_type: 'channel.participant_added' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      addedBy: userFromPrincipal(client, metadata.added_by),
      addedUsers: metadata.added_user_ids.map((userId) =>
        User.byId(client, userId),
      ),
    }))
    .with({ event_type: 'channel.participant_removed' }, ({ metadata }) => ({
      event_type: 'channel.participant_removed' as const,
      metadata,
      channel: Channel.byId(client, metadata.channel_id),
      removedBy: User.byId(client, metadata.removed_by),
      removedUsers: metadata.removed_user_ids.map((userId) =>
        User.byId(client, userId),
      ),
    }))
    .exhaustive();
}
