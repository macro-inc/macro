import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { storageServiceClient } from '@service-storage/client';
import type { ChannelJoinCodeResponse } from '@service-storage/generated/schemas/channelJoinCodeResponse';
import { useMutation } from '@tanstack/solid-query';
import {
  assertQueryAccount,
  currentQueryAccount,
  isCurrentQueryAccount,
  mutationQueryAccount,
} from '../auth/account-scope';
import { useQueryAccount } from '../auth/use-query-account';
import { queryClient } from '../client';
import { soupKeys } from '../soup/keys';
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
  callbacks?: JoinChannelByCodeCallbacks,
  account = currentQueryAccount()
) {
  return {
    gcTime: 0,
    meta: { queryAccount: account },
    mutationFn: async (
      { joinCode }: JoinChannelByCodeArgs,
      context: import('@tanstack/solid-query').MutationFunctionContext
    ) => {
      assertQueryAccount(mutationQueryAccount(context));
      await throwOnErr(() =>
        storageServiceClient.joinChannelByCode({ join_code: joinCode })
      );
    },
    ...withCallbacks<void, Error, JoinChannelByCodeArgs, undefined>(
      {
        onSuccess(_data, _variables, _result, context) {
          const owner = mutationQueryAccount(context);
          if (!isCurrentQueryAccount(owner)) return;
          queryClient.invalidateQueries({
            queryKey: channelKeys.listChannels(owner.userId).queryKey,
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
  const account = useQueryAccount();
  return useMutation(() =>
    joinChannelByCodeMutationOptions(callbacks, account())
  );
}

export type JoinChannelArgs = {
  channelId: string;
};

type JoinChannelCallbacks = MutationCallbacks<
  void,
  Error,
  JoinChannelArgs,
  undefined
>;

export function joinChannelMutationOptions(
  callbacks?: JoinChannelCallbacks,
  account = currentQueryAccount()
) {
  return {
    gcTime: 0,
    meta: { queryAccount: account },
    mutationFn: async (
      { channelId }: JoinChannelArgs,
      context: import('@tanstack/solid-query').MutationFunctionContext
    ) => {
      assertQueryAccount(mutationQueryAccount(context));
      await throwOnErr(() =>
        storageServiceClient.joinChannel({ channel_id: channelId })
      );
    },
    ...withCallbacks<void, Error, JoinChannelArgs, undefined>(
      {
        onSuccess(_data, _variables, _result, context) {
          const owner = mutationQueryAccount(context);
          if (!isCurrentQueryAccount(owner)) return;
          queryClient.invalidateQueries({
            queryKey: channelKeys.listChannels(owner.userId).queryKey,
          });
          // Refetch soup so the joined channel's is_participant flips and its
          // Join affordance disappears.
          queryClient.invalidateQueries({
            queryKey: soupKeys.items._def,
          });
          queryClient.invalidateQueries({
            queryKey: soupKeys.astItems._def,
          });
        },
        onError(error) {
          console.error('failed to join channel', error);
          toast.failure('Failed to join channel');
        },
      },
      callbacks
    ),
  };
}

/**
 * Joins a channel the viewer can see but is not a participant of (e.g. a team
 * channel of their team, surfaced in the Channels → Teams tab).
 */
export function useJoinChannelMutation(callbacks?: JoinChannelCallbacks) {
  const account = useQueryAccount();
  return useMutation(() => joinChannelMutationOptions(callbacks, account()));
}
