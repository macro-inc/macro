import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  type MessageResponse,
  storageServiceClient,
} from '@service-storage/client';
import { ChannelDetailSoupDocument } from '@service-storage/graphql/generated/graphql';
import { useMutation } from '@tanstack/solid-query';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import { channelNotificationRefresh } from './notification-refresh';

export const CHANNEL_PARTICIPANTS_MUTATION_KEY = [
  'channel-participants',
] as const;
const ADD_CHANNEL_PARTICIPANTS_MUTATION_KEY = [
  ...CHANNEL_PARTICIPANTS_MUTATION_KEY,
  'add',
] as const;
const REMOVE_CHANNEL_PARTICIPANTS_MUTATION_KEY = [
  ...CHANNEL_PARTICIPANTS_MUTATION_KEY,
  'remove',
] as const;

/**
 * How long a finished add or remove keeps showing after its last observer
 * leaves, so a reader opened meanwhile does not show the old roster before
 * the channel's soup update arrives.
 */
export const CHANNEL_PARTICIPANTS_MUTATION_GC_MS = 30_000;

export type ChannelParticipantsMutationVariables = {
  channelId: string;
  participants: string[];
};

/**
 * Re-reads the channel's GraphQL record for mounted participant readers after
 * a write the normalized cache cannot apply itself (a bot or agent joining,
 * an approved request, auto-join). Resolves without a request when nothing
 * reads the channel, and never fails the write that asked for it.
 */
export async function refreshChannelParticipants(channelId: string) {
  const input = buildGraphqlEntitySoupInput('CHANNEL', channelId);
  if (!input) return;
  await Promise.allSettled([
    refreshChannelDetail({
      document: ChannelDetailSoupDocument,
      variables: { input },
    }),
  ]);
}

// The soup client module sets up the GraphQL cache; load it only when a write
// needs a refresh, so mutation modules stay light to import.
async function refreshChannelDetail(query: QueryRevalidation) {
  const { getGraphqlSoupClient } = await import(
    '@service-storage/graphql-soup'
  );
  await channelNotificationRefresh(getGraphqlSoupClient()).refresh([query]);
}

// Readers show these mutations over the channel's participants while they are
// pending and until the channel's soup update confirms them
// (`useChannelParticipantsQuery`); a failed one drops out, which rolls it back.

/**
 * Mutation to add participants to a channel.
 */
export function useAddParticipantsMutation(
  callbacks?: MutationCallbacks<
    MessageResponse,
    Error,
    ChannelParticipantsMutationVariables,
    unknown
  >
) {
  return useMutation(() => ({
    mutationKey: ADD_CHANNEL_PARTICIPANTS_MUTATION_KEY,
    gcTime: CHANNEL_PARTICIPANTS_MUTATION_GC_MS,
    mutationFn: async (vars: ChannelParticipantsMutationVariables) => {
      return await throwOnErr(
        async () =>
          await storageServiceClient.addParticipantsToChannel({
            channel_id: vars.channelId,
            participants: vars.participants,
          })
      );
    },
    ...withCallbacks<
      MessageResponse,
      Error,
      ChannelParticipantsMutationVariables,
      unknown
    >(
      {
        onError(error) {
          console.error('failed to add participants', error);
          toast.failure('Failed to add participants to channel');
        },
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
    ChannelParticipantsMutationVariables,
    unknown
  >
) {
  return useMutation(() => ({
    mutationKey: REMOVE_CHANNEL_PARTICIPANTS_MUTATION_KEY,
    gcTime: CHANNEL_PARTICIPANTS_MUTATION_GC_MS,
    mutationFn: async (vars: ChannelParticipantsMutationVariables) => {
      return await throwOnErr(
        async () =>
          await storageServiceClient.removeParticipantsFromChannel({
            channel_id: vars.channelId,
            participants: vars.participants,
          })
      );
    },
    ...withCallbacks<
      MessageResponse,
      Error,
      ChannelParticipantsMutationVariables,
      unknown
    >(
      {
        onError(error) {
          console.error('failed to remove participants', error);
          toast.failure('Failed to remove participants from channel');
        },
      },
      callbacks
    ),
  }));
}
