import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type MessageResponse,
} from '@service-comms/client';
import type {
  CountedReaction,
  PostReactionRequest,
} from '@service-comms/generated/models';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { ChannelNonceKeys } from './keys';
import { getChannelMessagesQueryKeyPrefix } from './channel-messages';
import { createMutationNonce } from '../nonce';
import {
  replaceTargetReactions,
  softInvalidateTargetCaches,
  resolveMessageTarget,
  type MessageTarget,
} from './reconcile';

type WithChannelId<T> = T & { channelId: string };
type WithUserId<T> = T & { userId: string };

type ReactionList = CountedReaction[];
type WithReactionState<T> = T & {
  currentReactions?: ReactionList;
  threadId?: string;
};

export type AddReactionContext = {
  messageId: string;
  emoji: string;
  userId: string;
  previousReactions: ReactionList;
  target: MessageTarget;
};

export type RemoveReactionContext = {
  messageId: string;
  emoji: string;
  userId: string;
  previousReactions: ReactionList;
  target: MessageTarget;
};

function addUserReaction(
  reactions: ReactionList | undefined,
  emoji: string,
  userId: string
) {
  const messageReactions = reactions ?? [];
  const existing = messageReactions.find(
    (reaction) => reaction.emoji === emoji
  );

  if (existing?.users.includes(userId)) {
    return {
      reactions: messageReactions,
      didChange: false,
      wasNewReaction: false,
    };
  }

  return {
    reactions: existing
      ? messageReactions.map((reaction) =>
          reaction.emoji === emoji
            ? { ...reaction, users: [...reaction.users, userId] }
            : reaction
        )
      : [...messageReactions, { emoji, users: [userId] }],
    didChange: true,
    wasNewReaction: !existing,
  };
}

function removeUserReaction(
  reactions: ReactionList | undefined,
  emoji: string,
  userId: string
) {
  const messageReactions = reactions ?? [];
  const existing = messageReactions.find(
    (reaction) => reaction.emoji === emoji
  );

  if (!existing?.users.includes(userId)) {
    return {
      reactions: messageReactions,
      didChange: false,
      wasLastUser: false,
    };
  }

  return {
    reactions: messageReactions
      .map((reaction) =>
        reaction.emoji === emoji
          ? {
              ...reaction,
              users: reaction.users.filter(
                (existingUserId) => existingUserId !== userId
              ),
            }
          : reaction
      )
      .filter((reaction) => reaction.users.length > 0),
    didChange: true,
    wasLastUser: existing.users.length === 1,
  };
}

/**
 * Optimistically add a reaction to a message.
 * Returns minimal context for rollback.
 */
export function optimisticAddReaction(
  vars: WithChannelId<
    WithUserId<
      WithReactionState<Pick<PostReactionRequest, 'emoji' | 'message_id'>>
    >
  >
): AddReactionContext | undefined {
  const currentReactions = vars.currentReactions;
  const target = resolveMessageTarget({
    channelId: vars.channelId,
    messageId: vars.message_id,
    threadId: vars.threadId,
  });

  const result = addUserReaction(currentReactions, vars.emoji, vars.userId);
  if (!result.didChange) return;

  const context: AddReactionContext = {
    messageId: vars.message_id,
    emoji: vars.emoji,
    userId: vars.userId,
    previousReactions: currentReactions ?? [],
    target,
  };

  replaceTargetReactions(vars.channelId, context.target, result.reactions);

  return context;
}

/**
 * Rollback an optimistic add reaction by removing the user's reaction.
 */
export function rollbackAddReaction(
  channelId: string,
  context: AddReactionContext
): void {
  replaceTargetReactions(channelId, context.target, context.previousReactions);
}

/**
 * Optimistically remove a reaction from a message.
 * Returns minimal context for rollback.
 */
export function optimisticRemoveReaction(
  vars: WithChannelId<
    WithUserId<
      WithReactionState<Pick<PostReactionRequest, 'emoji' | 'message_id'>>
    >
  >
): RemoveReactionContext | undefined {
  const currentReactions = vars.currentReactions;
  const target = resolveMessageTarget({
    channelId: vars.channelId,
    messageId: vars.message_id,
    threadId: vars.threadId,
  });

  const result = removeUserReaction(currentReactions, vars.emoji, vars.userId);
  if (!result.didChange) return;

  const context: RemoveReactionContext = {
    messageId: vars.message_id,
    emoji: vars.emoji,
    userId: vars.userId,
    previousReactions: currentReactions ?? [],
    target,
  };

  replaceTargetReactions(vars.channelId, context.target, result.reactions);

  return context;
}

/**
 * Rollback an optimistic remove reaction by re-adding the user's reaction.
 */
export function rollbackRemoveReaction(
  channelId: string,
  context: RemoveReactionContext
): void {
  replaceTargetReactions(channelId, context.target, context.previousReactions);
}

type ReactionParams = {
  channelId: string;
  messageId: string;
  emoji: string;
  userId: string;
  currentReactions?: ReactionList;
  threadId?: string;
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
        onMutate: async (vars) => {
          addReactionNonce.prepare(vars);
          await queryClient.cancelQueries({
            queryKey: getChannelMessagesQueryKeyPrefix(vars.channelId),
          });
          return optimisticAddReaction({
            channelId: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            userId: vars.userId,
            currentReactions: vars.currentReactions,
            threadId: vars.threadId,
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
          softInvalidateTargetCaches(
            vars.channelId,
            resolveMessageTarget({
              channelId: vars.channelId,
              messageId: vars.messageId,
              threadId: vars.threadId,
            })
          );
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
        onMutate: async (vars) => {
          removeReactionNonce.prepare(vars);
          await queryClient.cancelQueries({
            queryKey: getChannelMessagesQueryKeyPrefix(vars.channelId),
          });
          return optimisticRemoveReaction({
            channelId: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            userId: vars.userId,
            currentReactions: vars.currentReactions,
            threadId: vars.threadId,
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
          softInvalidateTargetCaches(
            vars.channelId,
            resolveMessageTarget({
              channelId: vars.channelId,
              messageId: vars.messageId,
              threadId: vars.threadId,
            })
          );
        },
      },
      callbacks
    ),
  }));
}
