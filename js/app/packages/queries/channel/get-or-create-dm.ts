import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { commsServiceClient } from '@service-comms/client';
import type { GetOrCreateDmResponse } from '@service-comms/generated/models';
import { useMutation } from '@tanstack/solid-query';
import { invalidateListChannels } from './channels';

export type GetOrCreateDirectMessageParams = {
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
        commsServiceClient.getOrCreateDirectMessage({
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
