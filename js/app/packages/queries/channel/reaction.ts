import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type MessageResponse,
} from '@service-comms/client';
import type { GetChannelResponse } from '@service-comms/generated/models';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { invalidateChannelWithID } from './channel';
import { channelKeys } from './keys';
import { optimisticAddReaction, optimisticRemoveReaction } from './optimistic';

type ReactionParams = {
  channelId: string;
  messageId: string;
  emoji: string;
  userId: string;
};

type ReactionContext = { previous: GetChannelResponse | undefined };

/**
 * Mutation to add a reaction to a channel message.
 */
export function useAddReactionMutation(
  callbacks?: MutationCallbacks<
    MessageResponse,
    Error,
    ReactionParams,
    ReactionContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: ReactionParams) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.postReaction({
            channel_id: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            action: 'Add',
          })
      );
    },
    ...withCallbacks<MessageResponse, Error, ReactionParams, ReactionContext>(
      {
        onMutate: (vars) => {
          const previous = optimisticAddReaction({
            channelId: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            userId: vars.userId,
          });
          return { previous };
        },
        onError(error, vars, context) {
          console.error('failed to add reaction', error);
          toast.failure('Failed to add reaction');
          if (context?.previous) {
            queryClient.setQueryData(
              channelKeys.withID(vars.channelId).queryKey,
              context.previous
            );
          }
        },
        onSettled: (_, __, vars) => {
          invalidateChannelWithID(vars.channelId);
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
    ReactionContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (vars: ReactionParams) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.postReaction({
            channel_id: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            action: 'Remove',
          })
      );
    },
    ...withCallbacks<MessageResponse, Error, ReactionParams, ReactionContext>(
      {
        onMutate: (vars) => {
          const previous = optimisticRemoveReaction({
            channelId: vars.channelId,
            message_id: vars.messageId,
            emoji: vars.emoji,
            userId: vars.userId,
          });
          return { previous };
        },
        onError(error, vars, context) {
          console.error('failed to remove reaction', error);
          toast.failure('Failed to remove reaction');
          if (context?.previous) {
            queryClient.setQueryData(
              channelKeys.withID(vars.channelId).queryKey,
              context.previous
            );
          }
        },
        onSettled: (_, __, vars) => {
          invalidateChannelWithID(vars.channelId);
        },
      },
      callbacks
    ),
  }));
}
