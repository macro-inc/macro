import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { sleep } from '@core/util/sleep';
import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  type MessageResponse,
  storageServiceClient,
} from '@service-storage/client';
import { ChannelDetailSoupDocument } from '@service-storage/graphql/generated/graphql';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import { channelKeys } from './keys';
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
 * How long a succeeded add or remove shows over a record that does not have
 * it, so a reader opened meanwhile does not show the old roster before the
 * channel's soup update arrives. A reader that showed it all that time then
 * asks the server whether it still holds.
 */
export const CHANNEL_PARTICIPANTS_MUTATION_GC_MS = 30_000;

/**
 * How long a finished add or remove stays in the mutation cache after its last
 * observer leaves: past its showing time, so one the server has confirmed
 * keeps showing over a record whose soup update is late.
 */
const CHANNEL_PARTICIPANTS_MUTATION_RETAIN_MS = 5 * 60_000;

/** How long a write waits for the open readers to read the channel again. */
const READER_REFRESH_WAIT_MS = 3_000;

export type ChannelParticipantsMutationVariables = {
  channelId: string;
  participants: string[];
};

/**
 * Re-reads the channel's GraphQL record after a write the normalized cache
 * cannot apply itself (a bot or agent change, an approved request,
 * auto-join), so a cached roster no reader has open does not stay stale for
 * the next cache-first read. Never fails the write that asked for it.
 */
export async function refreshChannelParticipants(channelId: string) {
  const input = buildGraphqlEntitySoupInput('CHANNEL', channelId);
  if (!input) return;
  await Promise.allSettled([
    refreshChannelDetail({
      document: ChannelDetailSoupDocument,
      variables: { input },
    }),
    // Readers of a channel the soup read leaves out read REST instead.
    queryClient.invalidateQueries({
      queryKey: channelKeys.participantsFallback(channelId).queryKey,
    }),
  ]);
}

// The soup client module sets up the GraphQL cache; load it only when a write
// needs a refresh, so mutation modules stay light to import. Mounted readers
// refresh through the coordinator, which dedupes with notification refreshes,
// and the write waits for that read so its caller shows the new roster, as it
// did when it awaited the REST read; without one, a direct read updates the
// cached record.
async function refreshChannelDetail(query: QueryRevalidation) {
  const { getGraphqlSoupClient } = await import(
    '@service-storage/graphql-soup'
  );
  const client = getGraphqlSoupClient();
  const coordinator = channelNotificationRefresh(client);
  if (coordinator.invalidateQuery(query)) {
    // The coordinator can hold a refresh back (a read in flight, all its
    // slots busy, a suspended page); the write waits only so long.
    await Promise.race([
      coordinator.refresh([query]),
      sleep(READER_REFRESH_WAIT_MS),
    ]);
    return;
  }
  const result = await client
    .query(query.document, query.variables, { requestPolicy: 'network-only' })
    .toPromise();
  if (result.error) throw result.error;
}

/**
 * A reader showing REST rows (a channel the soup read leaves out, or a failed
 * read) gets no soup update for an add or remove, so it reads REST again once
 * the change succeeds rather than lose it when its overlay expires. The write
 * does not wait for that read.
 */
function rereadFallbackParticipants(
  _response: MessageResponse,
  { channelId }: ChannelParticipantsMutationVariables
) {
  fireAndForget(
    rereadParticipantsFromRest(channelId),
    'channel participants REST reread'
  );
}

async function rereadParticipantsFromRest(channelId: string) {
  const { queryKey } = channelKeys.participantsFallback(channelId);
  // A read started before the write answers with the roster before it, and a
  // first read with nothing cached yet would be joined rather than restarted.
  await queryClient.cancelQueries({ queryKey });
  await queryClient.invalidateQueries({ queryKey });
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
    gcTime: CHANNEL_PARTICIPANTS_MUTATION_RETAIN_MS,
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
        onSuccess: rereadFallbackParticipants,
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
    gcTime: CHANNEL_PARTICIPANTS_MUTATION_RETAIN_MS,
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
        onSuccess: rereadFallbackParticipants,
        onError(error) {
          console.error('failed to remove participants', error);
          toast.failure('Failed to remove participants from channel');
        },
      },
      callbacks
    ),
  }));
}
