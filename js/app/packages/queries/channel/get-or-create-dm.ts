import { throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  type GetOrCreateChannelResponse,
  storageServiceClient,
} from '@service-storage/client';
import { useMutation } from '@tanstack/solid-query';
import { invalidateListChannels } from './channels';

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
        onSettled: () => void invalidateListChannels(),
      },
      callbacks
    ),
  }));
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
        onSettled: () => void invalidateListChannels(),
      },
      callbacks
    ),
  }));
}
