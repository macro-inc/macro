import { toast } from '@core/component/Toast/Toast';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { CountedReaction } from '@service-storage/generated/schemas/countedReaction';
import type { MessageParent } from '@service-storage/messages';
import {
  type Message as EntityMessage,
  entityMessagesClient,
} from '@service-storage/messages';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { createMutationNonce } from '../nonce';
import { MessageNonceKeys } from './keys';
import {
  type MessageTarget,
  patchTargetMessage,
  resolveMessageTarget,
  softInvalidateTargetCaches,
} from './reconcile';
import { applyMessage } from './sync';
import { getMessageTimelineQueryKeyPrefix } from './timeline';

type WithParent<T> = T & { parent: MessageParent };
type WithUserId<T> = T & { userId: string };

type ReactionList = CountedReaction[];
type WithReactionState<T> = T & {
  currentReactions?: ReactionList;
  threadId?: string;
};

type ReactionContext = {
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
  };
}

/**
 * Optimistically add a reaction to a message.
 * Returns minimal context for rollback.
 */
export function optimisticAddReaction(
  vars: WithParent<
    WithUserId<WithReactionState<{ emoji: string; message_id: string }>>
  >
): ReactionContext | undefined {
  const currentReactions = vars.currentReactions;
  const target = resolveMessageTarget({
    parent: vars.parent,
    messageId: vars.message_id,
    threadId: vars.threadId,
  });

  const result = addUserReaction(currentReactions, vars.emoji, vars.userId);
  if (!result.didChange) return;

  const context: ReactionContext = {
    previousReactions: currentReactions ?? [],
    target,
  };

  patchTargetMessage(vars.parent, context.target, {
    reactions: result.reactions,
  });

  return context;
}

/**
 * Rollback an optimistic add reaction by removing the user's reaction.
 */
export function rollbackAddReaction(
  parent: MessageParent,
  context: ReactionContext
): void {
  patchTargetMessage(parent, context.target, {
    reactions: context.previousReactions,
  });
}

/**
 * Optimistically remove a reaction from a message.
 * Returns minimal context for rollback.
 */
export function optimisticRemoveReaction(
  vars: WithParent<
    WithUserId<WithReactionState<{ emoji: string; message_id: string }>>
  >
): ReactionContext | undefined {
  const currentReactions = vars.currentReactions;
  const target = resolveMessageTarget({
    parent: vars.parent,
    messageId: vars.message_id,
    threadId: vars.threadId,
  });

  const result = removeUserReaction(currentReactions, vars.emoji, vars.userId);
  if (!result.didChange) return;

  const context: ReactionContext = {
    previousReactions: currentReactions ?? [],
    target,
  };

  patchTargetMessage(vars.parent, context.target, {
    reactions: result.reactions,
  });

  return context;
}

/**
 * Rollback an optimistic remove reaction by re-adding the user's reaction.
 */
export function rollbackRemoveReaction(
  parent: MessageParent,
  context: ReactionContext
): void {
  patchTargetMessage(parent, context.target, {
    reactions: context.previousReactions,
  });
}

type ReactionParams = {
  parent: MessageParent;
  messageId: string;
  emoji: string;
  userId: string;
  currentReactions?: ReactionList;
  threadId?: string;
};

type ReactionMutationContext = ReactionContext | undefined;

const addReactionNonce = createMutationNonce<ReactionParams>(
  MessageNonceKeys.REACTION,
  (v) => `add:${v.parent.type}:${v.parent.id}:${v.messageId}:${v.emoji}`
);

const removeReactionNonce = createMutationNonce<ReactionParams>(
  MessageNonceKeys.REACTION,
  (v) => `remove:${v.parent.type}:${v.parent.id}:${v.messageId}:${v.emoji}`
);

/**
 * Mutation to add a reaction to a channel message.
 */
export function useAddReactionMutation(
  callbacks?: MutationCallbacks<
    EntityMessage,
    Error,
    ReactionParams,
    ReactionMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: ReactionParams) => {
      return entityMessagesClient.react(
        vars.parent,
        vars.messageId,
        vars.emoji,
        true,
        addReactionNonce.use(vars)
      );
    },
    ...withCallbacks<
      EntityMessage,
      Error,
      ReactionParams,
      ReactionMutationContext
    >(
      {
        onMutate: async (vars) => {
          addReactionNonce.prepare(vars);
          await queryClient.cancelQueries({
            queryKey: getMessageTimelineQueryKeyPrefix(vars.parent),
          });
          return optimisticAddReaction({
            parent: vars.parent,
            message_id: vars.messageId,
            emoji: vars.emoji,
            userId: vars.userId,
            currentReactions: vars.currentReactions,
            threadId: vars.threadId,
          });
        },
        onSuccess(data) {
          applyMessage(data, 'reaction_changed');
        },
        onError(error, vars, context) {
          console.error('failed to add reaction', error);
          toast.failure('Failed to add reaction');
          if (context) {
            rollbackAddReaction(vars.parent, context);
          }
        },
        onSettled: (_, __, vars) => {
          addReactionNonce.cleanup(vars);
          softInvalidateTargetCaches(
            vars.parent,
            resolveMessageTarget({
              parent: vars.parent,
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
    EntityMessage,
    Error,
    ReactionParams,
    ReactionMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: ReactionParams) => {
      return entityMessagesClient.react(
        vars.parent,
        vars.messageId,
        vars.emoji,
        false,
        removeReactionNonce.use(vars)
      );
    },
    ...withCallbacks<
      EntityMessage,
      Error,
      ReactionParams,
      ReactionMutationContext
    >(
      {
        onMutate: async (vars) => {
          removeReactionNonce.prepare(vars);
          await queryClient.cancelQueries({
            queryKey: getMessageTimelineQueryKeyPrefix(vars.parent),
          });
          return optimisticRemoveReaction({
            parent: vars.parent,
            message_id: vars.messageId,
            emoji: vars.emoji,
            userId: vars.userId,
            currentReactions: vars.currentReactions,
            threadId: vars.threadId,
          });
        },
        onSuccess(data) {
          applyMessage(data, 'reaction_changed');
        },
        onError(error, vars, context) {
          console.error('failed to remove reaction', error);
          toast.failure('Failed to remove reaction');
          if (context) {
            rollbackRemoveReaction(vars.parent, context);
          }
        },
        onSettled: (_, __, vars) => {
          removeReactionNonce.cleanup(vars);
          softInvalidateTargetCaches(
            vars.parent,
            resolveMessageTarget({
              parent: vars.parent,
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
