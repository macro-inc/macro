import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { storageServiceClient } from '@service-storage/client';
import type { ChannelJoinCodeResponse } from '@service-storage/generated/schemas/channelJoinCodeResponse';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { channelKeys } from './keys';

export type GetChannelJoinLinkArgs = {
  channelId: string;
};

type GetChannelJoinLinkCallbacks = MutationCallbacks<
  ChannelJoinCodeResponse,
  Error,
  GetChannelJoinLinkArgs,
  undefined
>;

export function getChannelJoinLinkMutationOptions(
  callbacks?: GetChannelJoinLinkCallbacks
) {
  return {
    gcTime: 0,
    mutationFn: async ({ channelId }: GetChannelJoinLinkArgs) =>
      await throwOnErr(() =>
        storageServiceClient.getChannelJoinLink({ channel_id: channelId })
      ),
    ...withCallbacks<
      ChannelJoinCodeResponse,
      Error,
      GetChannelJoinLinkArgs,
      undefined
    >(
      {
        onError(error) {
          console.error('failed to get channel join link', error);
          toast.failure('Failed to generate channel join link');
        },
      },
      callbacks
    ),
  };
}

/** Lazily gets or creates a channel join code when mutate is called. */
export function useGetChannelJoinLinkMutation(
  callbacks?: GetChannelJoinLinkCallbacks
) {
  return useMutation(() => getChannelJoinLinkMutationOptions(callbacks));
}

export type JoinChannelByCodeArgs = {
  joinCode: string;
};

type JoinChannelByCodeCallbacks = MutationCallbacks<
  void,
  Error,
  JoinChannelByCodeArgs,
  undefined
>;

export function joinChannelByCodeMutationOptions(
  callbacks?: JoinChannelByCodeCallbacks
) {
  return {
    gcTime: 0,
    mutationFn: async ({ joinCode }: JoinChannelByCodeArgs) => {
      await throwOnErr(() =>
        storageServiceClient.joinChannelByCode({ join_code: joinCode })
      );
    },
    ...withCallbacks<void, Error, JoinChannelByCodeArgs, undefined>(
      {
        onSuccess() {
          void queryClient.invalidateQueries({
            queryKey: channelKeys.listChannels.queryKey,
          });
        },
        onError(error) {
          console.error('failed to join channel by code', error);
          toast.failure('Failed to join channel');
        },
      },
      callbacks
    ),
  };
}

/** Joins a channel using its reusable join code. */
export function useJoinChannelByCodeMutation(
  callbacks?: JoinChannelByCodeCallbacks
) {
  return useMutation(() => joinChannelByCodeMutationOptions(callbacks));
}
