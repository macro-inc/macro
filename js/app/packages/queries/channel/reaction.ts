import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type ApiChannelMessage,
  type MessageResponse,
} from '@service-comms/client';
import type { PostReactionRequest } from '@service-comms/generated/models';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import {
  softInvalidateChannelMessages,
  type ChannelMessagesData,
} from './channel-messages';
import { channelKeys, ChannelNonceKeys } from './keys';
import { createMutationNonce } from '../nonce';

type WithChannelId<T> = T & { channelId: string };
type WithUserId<T> = T & { userId: string };

export type AddReactionContext = {
  messageId: string;
  emoji: string;
  userId: string;
  wasNewReaction: boolean;
};

export type RemoveReactionContext = {
  messageId: string;
  emoji: string;
  userId: string;
  wasLastUser: boolean;
};

/**
 * Map across all pages to find and update a specific message by ID.
 */
function updateMessageInPages(
  data: ChannelMessagesData,
  messageId: string,
  updater: (message: ApiChannelMessage) => ApiChannelMessage
): ChannelMessagesData {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((m) => (m.id === messageId ? updater(m) : m)),
    })),
  };
}

/**
 * Find a message or thread reply and update its reactions.
 * Returns the updated data and whether the target was found.
 */
function updateReactionsForMessage(
  data: ChannelMessagesData,
  messageId: string,
  updater: (
    reactions: { emoji: string; users: string[] }[]
  ) => { emoji: string; users: string[] }[]
): { data: ChannelMessagesData; found: boolean } {
  // Check top-level messages
  for (const page of data.pages) {
    if (page.items.some((m) => m.id === messageId)) {
      return {
        data: updateMessageInPages(data, messageId, (m) => ({
          ...m,
          reactions: updater(m.reactions),
        })),
        found: true,
      };
    }
  }

  // Check thread replies
  for (const page of data.pages) {
    for (const msg of page.items) {
      if (msg.thread.preview.some((r) => r.id === messageId)) {
        const updated = {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((m) => {
              if (m.id !== msg.id) return m;
              return {
                ...m,
                thread: {
                  ...m.thread,
                  preview: m.thread.preview.map((r) =>
                    r.id === messageId
                      ? { ...r, reactions: updater(r.reactions) }
                      : r
                  ),
                },
              };
            }),
          })),
        };
        return { data: updated, found: true };
      }
    }
  }

  return { data, found: false };
}

/**
 * Optimistically add a reaction to a message.
 */
export function optimisticAddReaction(
  vars: WithChannelId<
    WithUserId<Pick<PostReactionRequest, 'emoji' | 'message_id'>>
  >
): AddReactionContext | undefined {
  const queryKey = channelKeys.messages(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: AddReactionContext | undefined;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    const result = updateReactionsForMessage(
      prev,
      vars.message_id,
      (reactions) => {
        const existing = reactions.find((r) => r.emoji === vars.emoji);
        if (existing?.users.includes(vars.userId)) return reactions;

        context = {
          messageId: vars.message_id,
          emoji: vars.emoji,
          userId: vars.userId,
          wasNewReaction: !existing,
        };

        return existing
          ? reactions.map((r) =>
              r.emoji === vars.emoji
                ? { ...r, users: [...r.users, vars.userId] }
                : r
            )
          : [...reactions, { emoji: vars.emoji, users: [vars.userId] }];
      }
    );

    return result.data;
  });

  return context;
}

/**
 * Rollback an optimistic add reaction.
 */
export function rollbackAddReaction(
  channelId: string,
  context: AddReactionContext
): void {
  const queryKey = channelKeys.messages(channelId).queryKey;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    const result = updateReactionsForMessage(
      prev,
      context.messageId,
      (reactions) => {
        if (context.wasNewReaction) {
          return reactions.filter((r) => r.emoji !== context.emoji);
        }
        return reactions.map((r) =>
          r.emoji === context.emoji
            ? { ...r, users: r.users.filter((id) => id !== context.userId) }
            : r
        );
      }
    );

    return result.data;
  });
}

/**
 * Optimistically remove a reaction from a message.
 */
export function optimisticRemoveReaction(
  vars: WithChannelId<
    WithUserId<Pick<PostReactionRequest, 'emoji' | 'message_id'>>
  >
): RemoveReactionContext | undefined {
  const queryKey = channelKeys.messages(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: RemoveReactionContext | undefined;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    const result = updateReactionsForMessage(
      prev,
      vars.message_id,
      (reactions) => {
        const existing = reactions.find((r) => r.emoji === vars.emoji);
        if (!existing?.users.includes(vars.userId)) return reactions;

        context = {
          messageId: vars.message_id,
          emoji: vars.emoji,
          userId: vars.userId,
          wasLastUser: existing.users.length === 1,
        };

        return reactions
          .map((r) =>
            r.emoji === vars.emoji
              ? { ...r, users: r.users.filter((id) => id !== vars.userId) }
              : r
          )
          .filter((r) => r.users.length > 0);
      }
    );

    return result.data;
  });

  return context;
}

/**
 * Rollback an optimistic remove reaction.
 */
export function rollbackRemoveReaction(
  channelId: string,
  context: RemoveReactionContext
): void {
  const queryKey = channelKeys.messages(channelId).queryKey;

  queryClient.setQueryData<ChannelMessagesData>(queryKey, (prev) => {
    if (!prev?.pages?.length) return prev;

    const result = updateReactionsForMessage(
      prev,
      context.messageId,
      (reactions) => {
        const existing = reactions.find((r) => r.emoji === context.emoji);
        if (existing) {
          return reactions.map((r) =>
            r.emoji === context.emoji
              ? { ...r, users: [...r.users, context.userId] }
              : r
          );
        }
        return [
          ...reactions,
          { emoji: context.emoji, users: [context.userId] },
        ];
      }
    );

    return result.data;
  });
}

type ReactionParams = {
  channelId: string;
  messageId: string;
  emoji: string;
  userId: string;
};

type AddReactionMutationContext = AddReactionContext | undefined;
type RemoveReactionMutationContext = RemoveReactionContext | undefined;

const addReactionNonce = createMutationNonce<ReactionParams>(
  ChannelNonceKeys.REACTION,
  (v) => `add:${v.channelId}:${v.messageId}:${v.emoji}`
);

const removeReactionNonce = createMutationNonce<ReactionParams>(
  ChannelNonceKeys.REACTION,
  (v) => `remove:${v.channelId}:${v.messageId}:${v.emoji}`
);

/**
 * Mutation to add a reaction to a channel message.
 */
export function useAddReactionMutation(
  callbacks?: MutationCallbacks<
    MessageResponse,
    Error,
    ReactionParams,
    AddReactionMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: ReactionParams) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.postReaction({
            channel_id: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            action: 'Add',
            nonce: addReactionNonce.use(vars),
          })
      );
    },
    ...withCallbacks<
      MessageResponse,
      Error,
      ReactionParams,
      AddReactionMutationContext
    >(
      {
        onMutate: (vars) => {
          addReactionNonce.prepare(vars);
          return optimisticAddReaction({
            channelId: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            userId: vars.userId,
          });
        },
        onError(error, vars, context) {
          console.error('failed to add reaction', error);
          toast.failure('Failed to add reaction');
          if (context) {
            rollbackAddReaction(vars.channelId, context);
          }
        },
        onSettled: (_, __, vars) => {
          addReactionNonce.cleanup(vars);
          softInvalidateChannelMessages(vars.channelId);
        },
      },
      callbacks
    ),
  }));
}

/**
 * Mutation to remove a reaction from a channel message.
 */
export function useRemoveReactionMutation(
  callbacks?: MutationCallbacks<
    MessageResponse,
    Error,
    ReactionParams,
    RemoveReactionMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: ReactionParams) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.postReaction({
            channel_id: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            action: 'Remove',
            nonce: removeReactionNonce.use(vars),
          })
      );
    },
    ...withCallbacks<
      MessageResponse,
      Error,
      ReactionParams,
      RemoveReactionMutationContext
    >(
      {
        onMutate: (vars) => {
          removeReactionNonce.prepare(vars);
          return optimisticRemoveReaction({
            channelId: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            userId: vars.userId,
          });
        },
        onError(error, vars, context) {
          console.error('failed to remove reaction', error);
          toast.failure('Failed to remove reaction');
          if (context) {
            rollbackRemoveReaction(vars.channelId, context);
          }
        },
        onSettled: (_, __, vars) => {
          removeReactionNonce.cleanup(vars);
          softInvalidateChannelMessages(vars.channelId);
        },
      },
      callbacks
    ),
  }));
}
