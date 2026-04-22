import { toast } from '@core/component/Toast/Toast';
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
 * Runs {@link useGetOrCreateDirectMessageMutation}'s `mutateAsync`; on success calls `onOpened`.
 * Errors are swallowed here because the mutation registers `onError` (toast + log).
 */
export async function openDirectMessageWithMutation(
  mutateAsync: (
    vars: GetOrCreateDirectMessageParams,
  ) => Promise<GetOrCreateDmResponse>,
  vars: GetOrCreateDirectMessageParams,
  onOpened: (channelId: string) => void,
): Promise<void> {
  try {
    const { channel_id } = await mutateAsync(vars);
    onOpened(channel_id);
  } catch {
    // handled by mutation `onError`
  }
}

/**
 * Create or resolve a 1:1 DM channel for a recipient. Invalidates the channel list on settle.
 */
export function useGetOrCreateDirectMessageMutation(
  callbacks?: MutationCallbacks<
    GetOrCreateDmResponse,
    Error,
    GetOrCreateDirectMessageParams,
    undefined
  >,
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: GetOrCreateDirectMessageParams) => {
      return await throwOnErr(async () =>
        commsServiceClient.getOrCreateDirectMessage({
          recipient_id: vars.recipient_id,
        }),
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
          toast.failure('Could not open direct message');
        },
        onSettled: () => void invalidateListChannels(),
      },
      callbacks,
    ),
  }));
}
