import type {
  ChannelMessage,
  GetChannelResponse,
  Message,
  PostMessageRequest,
  PostReactionRequest,
} from '@service-comms/generated/models';
import { queryClient } from '../client';
import { channelKeys } from './keys';

type WithChannelId<T> = T & { channelId: string };
type WithOptimisticId<T> = T & { optimisticId: string };
type WithSenderId<T> = T & { senderId: string };
type WithUserId<T> = T & { userId: string };

/**
 * Optimistically insert a new message into the channel cache.
 * Returns the previous cache data for rollback on error.
 */
export function optimisticInsertChannelMessage(
  vars: WithChannelId<WithOptimisticId<WithSenderId<PostMessageRequest>>>
): GetChannelResponse | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let previous: GetChannelResponse | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      previous = prev;
      const now = new Date().toISOString();

      const newMessage: Message = {
        id: vars.optimisticId,
        channel_id: vars.channelId,
        sender_id: vars.senderId,
        content: vars.content,
        thread_id: vars.thread_id ?? undefined,
        created_at: now,
        updated_at: now,
        deleted_at: undefined,
        edited_at: undefined,
      };

      return {
        ...prev,
        messages: [...prev.messages, newMessage],
      };
    }
  );

  return previous;
}

/**
 * Replace an optimistic message ID with the real server-assigned ID.
 * Called in mutation onSuccess after server returns the real message.
 */
export function replaceOptimisticMessage(
  vars: WithChannelId<{ optimisticId: string; realId: string }>
): void {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const messageIndex = prev.messages.findIndex(
        (m) => m.id === vars.optimisticId
      );

      if (messageIndex === -1) return prev;

      const updatedMessages = [...prev.messages];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        id: vars.realId,
      };

      return {
        ...prev,
        messages: updatedMessages,
      };
    }
  );
}

/**
 * Optimistically delete a message from the channel cache.
 * Also removes associated reactions and attachments.
 * Returns the previous cache data for rollback on error.
 */
export function optimisticDeleteChannelMessage(
  vars: WithChannelId<Pick<ChannelMessage, 'message_id'>>
): GetChannelResponse | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let previous: GetChannelResponse | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      previous = prev;

      const filteredMessages = prev.messages.filter(
        (m) => m.id !== vars.message_id
      );

      // Remove reactions for the deleted message
      const { [vars.message_id]: _removedReactions, ...remainingReactions } =
        prev.reactions;

      // Remove attachments linked to the deleted message
      const filteredAttachments = prev.attachments.filter(
        (a) => a.message_id !== vars.message_id
      );

      return {
        ...prev,
        messages: filteredMessages,
        reactions: remainingReactions,
        attachments: filteredAttachments,
      };
    }
  );

  return previous;
}

/**
 * Optimistically update a message's content in the channel cache.
 * Returns the previous cache data for rollback on error.
 */
export function optimisticUpdateChannelMessage(
  vars: WithChannelId<Pick<ChannelMessage, 'message_id' | 'content'>>
): GetChannelResponse | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let previous: GetChannelResponse | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;
      previous = prev;
      const now = new Date().toISOString();

      return {
        ...prev,
        messages: prev.messages.map((m) =>
          m.id === vars.message_id
            ? { ...m, content: vars.content, edited_at: now, updated_at: now }
            : m
        ),
      };
    }
  );

  return previous;
}

/**
 * Optimistically add a reaction to a message.
 * Returns the previous cache data for rollback on error.
 */
export function optimisticAddReaction(
  vars: WithChannelId<
    WithUserId<Pick<PostReactionRequest, 'emoji' | 'message_id'>>
  >
): GetChannelResponse | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let previous: GetChannelResponse | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;
      previous = prev;

      const messageReactions = prev.reactions[vars.message_id] ?? [];
      const existing = messageReactions.find((r) => r.emoji === vars.emoji);

      if (existing?.users.includes(vars.userId)) return prev;

      const updatedMessageReactions = existing
        ? messageReactions.map((r) =>
            r.emoji === vars.emoji
              ? { ...r, users: [...r.users, vars.userId] }
              : r
          )
        : [...messageReactions, { emoji: vars.emoji, users: [vars.userId] }];

      return {
        ...prev,
        reactions: {
          ...prev.reactions,
          [vars.message_id]: updatedMessageReactions,
        },
      };
    }
  );

  return previous;
}

/**
 * Optimistically remove a reaction from a message.
 * Returns the previous cache data for rollback on error.
 */
export function optimisticRemoveReaction(
  vars: WithChannelId<
    WithUserId<Pick<PostReactionRequest, 'emoji' | 'message_id'>>
  >
): GetChannelResponse | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let previous: GetChannelResponse | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;
      previous = prev;

      const messageReactions = prev.reactions[vars.message_id];
      if (!messageReactions?.some((r) => r.emoji === vars.emoji)) return prev;

      const updated = messageReactions
        .map((r) =>
          r.emoji === vars.emoji
            ? { ...r, users: r.users.filter((id) => id !== vars.userId) }
            : r
        )
        .filter((r) => r.users.length > 0);

      if (updated.length === 0) {
        const { [vars.message_id]: _, ...rest } = prev.reactions;
        return { ...prev, reactions: rest };
      }

      return {
        ...prev,
        reactions: { ...prev.reactions, [vars.message_id]: updated },
      };
    }
  );

  return previous;
}

/**
 * Optimistically update the channel name.
 * Note: The main implementation is in channel.ts. This function
 * delegates to maintain API consistency in the optimistic module.
 */
export function optimisticUpdateChannelName(
  vars: WithChannelId<{ name: string }>
): GetChannelResponse | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let previous: GetChannelResponse | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      previous = prev;

      return {
        ...prev,
        channel: {
          ...prev.channel,
          name: vars.name,
          updated_at: new Date().toISOString(),
        },
      };
    }
  );

  return previous;
}
