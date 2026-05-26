import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type MessageResponse,
} from '@service-comms/client';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { softInvalidateChannelParticipants } from './channel-participants';
import { channelKeys } from './keys';
import type { ChannelParticipant } from './types';

type WithChannelId<T> = T & { channelId: string };

type AddParticipantsContext = {
  addedUserIds: string[];
};

type RemoveParticipantsContext = {
  removedParticipants: ChannelParticipant[];
};

/**
 * Optimistically add participants to a channel.
 * Returns minimal context for rollback.
 */
function optimisticAddParticipants(
  vars: WithChannelId<{ participants: string[] }>
): AddParticipantsContext | undefined {
  const participantsQueryKey = channelKeys.participants(
    vars.channelId
  ).queryKey;
  queryClient.cancelQueries({ queryKey: participantsQueryKey });

  let context: AddParticipantsContext | undefined;
  queryClient.setQueryData(
    participantsQueryKey,
    (prev: ChannelParticipant[] | undefined) => {
      if (!prev) return prev;

      const existingUserIds = new Set(
        prev.map((participant) => participant.user_id)
      );
      const addedUserIds = vars.participants.filter(
        (userId) => !existingUserIds.has(userId)
      );

      if (addedUserIds.length === 0) return prev;
      context = { addedUserIds };

      const addedParticipants: ChannelParticipant[] = addedUserIds.map(
        (userId) => ({
          user_id: userId,
          role: 'member',
          left_at: null,
          joined_at: new Date().toISOString(),
          channel_id: vars.channelId,
        })
      );

      return [...prev, ...addedParticipants];
    }
  );

  return context;
}

/**
 * Rollback an optimistic add participants by removing them.
 */
function rollbackAddParticipants(
  channelId: string,
  context: AddParticipantsContext
): void {
  const participantsQueryKey = channelKeys.participants(channelId).queryKey;

  queryClient.setQueryData(
    participantsQueryKey,
    (prev: ChannelParticipant[] | undefined) => {
      if (!prev) return prev;

      const addedSet = new Set(context.addedUserIds);
      return prev.filter((participant) => !addedSet.has(participant.user_id));
    }
  );
}

/**
 * Optimistically remove participants from a channel.
 * Returns minimal context for rollback.
 */
function optimisticRemoveParticipants(
  vars: WithChannelId<{ participants: string[] }>
): RemoveParticipantsContext | undefined {
  const participantsQueryKey = channelKeys.participants(
    vars.channelId
  ).queryKey;
  queryClient.cancelQueries({ queryKey: participantsQueryKey });

  let context: RemoveParticipantsContext | undefined;

  queryClient.setQueryData(
    participantsQueryKey,
    (prev: ChannelParticipant[] | undefined) => {
      if (!prev) return prev;

      const toRemoveSet = new Set(vars.participants);
      const removedParticipants = prev.filter((participant) =>
        toRemoveSet.has(participant.user_id)
      );

      if (removedParticipants.length === 0) return prev;
      if (!context) {
        context = { removedParticipants };
      }

      return prev.filter(
        (participant) => !toRemoveSet.has(participant.user_id)
      );
    }
  );

  return context;
}

/**
 * Rollback an optimistic remove participants by re-adding them.
 */
function rollbackRemoveParticipants(
  channelId: string,
  context: RemoveParticipantsContext
): void {
  const participantsQueryKey = channelKeys.participants(channelId).queryKey;

  queryClient.setQueryData(
    participantsQueryKey,
    (prev: ChannelParticipant[] | undefined) => {
      if (!prev) return prev;

      const existingUserIds = new Set(
        prev.map((participant) => participant.user_id)
      );
      const restoredParticipants = context.removedParticipants.filter(
        (participant) => !existingUserIds.has(participant.user_id)
      );

      if (restoredParticipants.length === 0) return prev;
      return [...prev, ...restoredParticipants];
    }
  );
}

type AddParticipantsParams = {
  channelId: string;
  participants: string[];
};

type RemoveParticipantsParams = {
  channelId: string;
  participants: string[];
};

type AddParticipantsMutationContext = AddParticipantsContext | undefined;
type RemoveParticipantsMutationContext = RemoveParticipantsContext | undefined;

/**
 * Mutation to add participants to a channel.
 */
export function useAddParticipantsMutation(
  callbacks?: MutationCallbacks<
    MessageResponse,
    Error,
    AddParticipantsParams,
    AddParticipantsMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: AddParticipantsParams) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.addParticipantsToChanenl({
            channel_id: vars.channelId,
            participants: vars.participants,
          })
      );
    },
    ...withCallbacks<
      MessageResponse,
      Error,
      AddParticipantsParams,
      AddParticipantsMutationContext
    >(
      {
        onMutate: (vars) =>
          optimisticAddParticipants({
            channelId: vars.channelId,
            participants: vars.participants,
          }),
        onError(error, vars, context) {
          console.error('failed to add participants', error);
          toast.failure('Failed to add participants to channel');
          if (context) {
            rollbackAddParticipants(vars.channelId, context);
          }
        },
        onSettled: (_, __, vars) =>
          softInvalidateChannelParticipants(vars.channelId),
      },
      callbacks
    ),
  }));
}

/**
 * Mutation to remove participants from a channel.
 */
export function useRemoveParticipantsMutation(
  callbacks?: MutationCallbacks<
    MessageResponse,
    Error,
    RemoveParticipantsParams,
    RemoveParticipantsMutationContext
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: RemoveParticipantsParams) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.removeParticipantsFromChannel({
            channel_id: vars.channelId,
            participants: vars.participants,
          })
      );
    },
    ...withCallbacks<
      MessageResponse,
      Error,
      RemoveParticipantsParams,
      RemoveParticipantsMutationContext
    >(
      {
        onMutate: (vars) =>
          optimisticRemoveParticipants({
            channelId: vars.channelId,
            participants: vars.participants,
          }),
        onError(error, vars, context) {
          console.error('failed to remove participants', error);
          toast.failure('Failed to remove participants from channel');
          if (context) {
            rollbackRemoveParticipants(vars.channelId, context);
          }
        },
        onSettled: (_, __, vars) =>
          softInvalidateChannelParticipants(vars.channelId),
      },
      callbacks
    ),
  }));
}
