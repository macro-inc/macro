import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import {
  type GetOrCreateChannelResponse,
  storageServiceClient,
} from '@service-storage/client';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { useMutation } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import { invalidateListChannels, loadChannelList } from './channels';

type GetOrCreateDmResponse = GetOrCreateChannelResponse;

type GetOrCreateDirectMessageParams = {
  recipient_id: string;
};

/**
 * Create or resolve a 1:1 DM channel for a recipient. Invalidates the channel list on settle.
 */
export function useGetOrCreateDirectMessageMutation(
  callbacks?: MutationCallbacks<
    GetOrCreateDmResponse,
    Error,
    GetOrCreateDirectMessageParams,
    undefined
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: GetOrCreateDirectMessageParams) => {
      return await throwOnErr(async () =>
        storageServiceClient.getOrCreateDirectMessage({
          recipient_id: vars.recipient_id,
        })
      );
    },
    ...withCallbacks<
      GetOrCreateDmResponse,
      Error,
      GetOrCreateDirectMessageParams,
      undefined
    >(
      {
        onError(error) {
          console.error('failed to get or create direct message', error);
        },
        onSettled: () =>
          fireAndForget(invalidateListChannels(), 'channel-list'),
      },
      callbacks
    ),
  }));
}

/**
 * The 1:1 DM between `viewerId` and `recipientId` in a channel list, picked as
 * the server's get-or-create picks it: the oldest two-member DM with both.
 */
function findDirectMessage(
  channels: ApiChannelWithLatest[],
  viewerId: string,
  recipientId: string
): string | undefined {
  let found: ApiChannelWithLatest | undefined;
  for (const channel of channels) {
    if (channel.channel_type !== ChannelType.direct_message) continue;
    if (channel.participants.length !== 2) continue;
    const members = channel.participants.map(({ user_id }) => user_id);
    if (!members.includes(viewerId) || !members.includes(recipientId)) continue;
    if (!found || channel.created_at < found.created_at) found = channel;
  }
  return found?.id;
}

/**
 * The viewer's existing DM with a recipient, without creating one. Reads the
 * channel list the app already keeps, fetching it only when it isn't loaded.
 */
export function existingDirectMessage(
  viewerId: string,
  recipientId: string
): ResultAsync<string | undefined, unknown> {
  return ResultAsync.fromPromise(loadChannelList(), (error) => error).map(
    (channels) => findDirectMessage(channels, viewerId, recipientId)
  );
}

type GetOrCreatePrivateChannelParams = {
  recipients: string[];
};

/**
 * Create or resolve a private group channel for a set of recipients. Invalidates the channel list on settle.
 */
export function useGetOrCreatePrivateChannelMutation(
  callbacks?: MutationCallbacks<
    GetOrCreateChannelResponse,
    Error,
    GetOrCreatePrivateChannelParams,
    undefined
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: GetOrCreatePrivateChannelParams) => {
      return await throwOnErr(async () =>
        storageServiceClient.getOrCreatePrivateChannel({
          recipients: vars.recipients,
        })
      );
    },
    ...withCallbacks<
      GetOrCreateChannelResponse,
      Error,
      GetOrCreatePrivateChannelParams,
      undefined
    >(
      {
        onError(error) {
          console.error('failed to get or create private channel', error);
        },
        onSettled: () =>
          fireAndForget(invalidateListChannels(), 'channel-list'),
      },
      callbacks
    ),
  }));
}
