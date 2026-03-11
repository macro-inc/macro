import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type MessageResponse,
} from '@service-comms/client';
import type { PostReactionRequest } from '@service-comms/generated/models';
import type { GetChannelResponse } from './types';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { softInvalidateChannelWithID } from './channel';
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
 * Optimistically add a reaction to a message.
 * Returns minimal context for rollback.
 */
export function optimisticAddReaction(
  vars: WithChannelId<
    WithUserId<Pick<PostReactionRequest, 'emoji' | 'message_id'>>
  >
): AddReactionContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: AddReactionContext | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const messageReactions = prev.reactions[vars.message_id] ?? [];
      const existing = messageReactions.find((r) => r.emoji === vars.emoji);

      if (existing?.users.includes(vars.userId)) return prev;

      context = {
        messageId: vars.message_id,
        emoji: vars.emoji,
        userId: vars.userId,
        wasNewReaction: !existing,
      };

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

  return context;
}

/**
 * Rollback an optimistic add reaction by removing the user's reaction.
 */
export function rollbackAddReaction(
  channelId: string,
  context: AddReactionContext
): void {
  const queryKey = channelKeys.withID(channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const messageReactions = prev.reactions[context.messageId];
      if (!messageReactions) return prev;

      if (context.wasNewReaction) {
        const updated = messageReactions.filter(
          (r) => r.emoji !== context.emoji
        );
        if (updated.length === 0) {
          const { [context.messageId]: _, ...rest } = prev.reactions;
          return { ...prev, reactions: rest };
        }
        return {
          ...prev,
          reactions: { ...prev.reactions, [context.messageId]: updated },
        };
      } else {
        const updated = messageReactions.map((r) =>
          r.emoji === context.emoji
            ? { ...r, users: r.users.filter((id) => id !== context.userId) }
            : r
        );
        return {
          ...prev,
          reactions: { ...prev.reactions, [context.messageId]: updated },
        };
      }
    }
  );
}

/**
 * Optimistically remove a reaction from a message.
 * Returns minimal context for rollback.
 */
export function optimisticRemoveReaction(
  vars: WithChannelId<
    WithUserId<Pick<PostReactionRequest, 'emoji' | 'message_id'>>
  >
): RemoveReactionContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: RemoveReactionContext | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const messageReactions = prev.reactions[vars.message_id];
      const existing = messageReactions?.find((r) => r.emoji === vars.emoji);
      if (!existing?.users.includes(vars.userId)) return prev;

      context = {
        messageId: vars.message_id,
        emoji: vars.emoji,
        userId: vars.userId,
        wasLastUser: existing.users.length === 1,
      };

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

  return context;
}

/**
 * Rollback an optimistic remove reaction by re-adding the user's reaction.
 */
export function rollbackRemoveReaction(
  channelId: string,
  context: RemoveReactionContext
): void {
  const queryKey = channelKeys.withID(channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const messageReactions = prev.reactions[context.messageId] ?? [];

      const existing = messageReactions.find((r) => r.emoji === context.emoji);

      if (existing) {
        const updated = messageReactions.map((r) =>
          r.emoji === context.emoji
            ? { ...r, users: [...r.users, context.userId] }
            : r
        );
        return {
          ...prev,
          reactions: { ...prev.reactions, [context.messageId]: updated },
        };
      }

      return {
        ...prev,
        reactions: {
          ...prev.reactions,
          [context.messageId]: [
            ...messageReactions,
            { emoji: context.emoji, users: [context.userId] },
          ],
        },
      };
    }
  );
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
          softInvalidateChannelWithID(vars.channelId);
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
          softInvalidateChannelWithID(vars.channelId);
        },
      },
      callbacks
    ),
  }));
}
