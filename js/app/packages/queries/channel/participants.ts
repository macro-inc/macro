import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type MessageResponse,
} from '@service-comms/client';
import type { ChannelParticipant, GetChannelResponse } from './types';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { softInvalidateChannelWithID } from './channel';
import { channelKeys } from './keys';

type WithChannelId<T> = T & { channelId: string };

export type AddParticipantsContext = {
  addedUserIds: string[];
};

export type RemoveParticipantsContext = {
  removedParticipants: ChannelParticipant[];
};

/**
 * Optimistically add participants to a channel.
 * Returns minimal context for rollback.
 */
export function optimisticAddParticipants(
  vars: WithChannelId<{ participants: string[] }>
): AddParticipantsContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: AddParticipantsContext | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const existingUserIds = new Set(prev.participants.map((p) => p.user_id));
      const newUserIds = vars.participants.filter(
        (id) => !existingUserIds.has(id)
      );

      if (newUserIds.length === 0) return prev;

      context = { addedUserIds: newUserIds };

      const newParticipants: ChannelParticipant[] = newUserIds.map(
        (userId) => ({
          user_id: userId,
          role: 'member',
          left_at: null,
          joined_at: new Date().toISOString(),
          channel_id: vars.channelId,
        })
      );

      return {
        ...prev,
        participants: [...prev.participants, ...newParticipants],
      };
    }
  );

  return context;
}

/**
 * Rollback an optimistic add participants by removing them.
 */
export function rollbackAddParticipants(
  channelId: string,
  context: AddParticipantsContext
): void {
  const queryKey = channelKeys.withID(channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const addedSet = new Set(context.addedUserIds);
      return {
        ...prev,
        participants: prev.participants.filter((p) => !addedSet.has(p.user_id)),
      };
    }
  );
}

/**
 * Optimistically remove participants from a channel.
 * Returns minimal context for rollback.
 */
export function optimisticRemoveParticipants(
  vars: WithChannelId<{ participants: string[] }>
): RemoveParticipantsContext | undefined {
  const queryKey = channelKeys.withID(vars.channelId).queryKey;
  queryClient.cancelQueries({ queryKey });

  let context: RemoveParticipantsContext | undefined;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      const toRemoveSet = new Set(vars.participants);
      const removedParticipants = prev.participants.filter((p) =>
        toRemoveSet.has(p.user_id)
      );

      if (removedParticipants.length === 0) return prev;

      context = { removedParticipants };

      return {
        ...prev,
        participants: prev.participants.filter(
          (p) => !toRemoveSet.has(p.user_id)
        ),
      };
    }
  );

  return context;
}

/**
 * Rollback an optimistic remove participants by re-adding them.
 */
export function rollbackRemoveParticipants(
  channelId: string,
  context: RemoveParticipantsContext
): void {
  const queryKey = channelKeys.withID(channelId).queryKey;

  queryClient.setQueriesData(
    { queryKey },
    (prev: GetChannelResponse | undefined) => {
      if (!prev) return prev;

      return {
        ...prev,
        participants: [...prev.participants, ...context.removedParticipants],
      };
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
        onSettled: (_, __, vars) => softInvalidateChannelWithID(vars.channelId),
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
        onSettled: (_, __, vars) => softInvalidateChannelWithID(vars.channelId),
      },
      callbacks
    ),
  }));
}
