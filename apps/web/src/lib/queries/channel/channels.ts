import { analytics } from '@app/lib/analytics';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import {
  type MessageResponse,
  storageServiceClient,
} from '@service-storage/client';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import type { CreateChannelRequest } from '@service-storage/generated/schemas/createChannelRequest';
import type { CreateChannelResponse } from '@service-storage/generated/schemas/createChannelResponse';
import type { PatchChannelRequest } from '@service-storage/generated/schemas/patchChannelRequest';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { invalidateChannelParticipants } from './channel-participants';
import { channelKeys } from './keys';

export function useListChannelsQuery() {
  return useQuery(() => ({
    queryKey: channelKeys.listChannels.queryKey,
    queryFn: async () => await throwOnErr(storageServiceClient.getChannels),
  }));
}

export function invalidateListChannels() {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.listChannels.queryKey,
  });
}

/**
 * Create a channel. Invalidates the channel list on settle.
 */
export function useCreateChannelMutation(
  callbacks?: MutationCallbacks<
    CreateChannelResponse,
    Error,
    CreateChannelRequest,
    undefined
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: CreateChannelRequest) => {
      return await throwOnErr(async () =>
        storageServiceClient.createChannel(vars)
      );
    },
    ...withCallbacks<
      CreateChannelResponse,
      Error,
      CreateChannelRequest,
      undefined
    >(
      {
        onError(error) {
          console.error('failed to create channel', error);
        },
        onSuccess: (data) => {
          analytics.track('create_entity', {
            entityType: 'channel',
            entityId: data.id,
          });
        },
        onSettled: () => void invalidateListChannels(),
      },
      callbacks
    ),
  }));
}

export type PatchChannelParams = PatchChannelRequest & { channelId: string };
type PatchChannelCallbacks = MutationCallbacks<
  MessageResponse,
  Error,
  PatchChannelParams
>;

function updateCachedChannel(
  channels: ApiChannelWithLatest[] | undefined,
  vars: PatchChannelParams
): ApiChannelWithLatest[] | undefined {
  return channels?.map((channel) => {
    if (channel.id !== vars.channelId) return channel;

    return {
      ...channel,
      channel_type:
        vars.convert_to_team_channel === true
          ? ChannelType.team
          : channel.channel_type,
      auto_join_team:
        typeof vars.auto_join_team === 'boolean'
          ? vars.auto_join_team
          : channel.auto_join_team,
    };
  });
}

/** Patch channel settings and refresh channel/participant state. */
export function usePatchChannelMutation(callbacks?: PatchChannelCallbacks) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async ({ channelId, ...request }: PatchChannelParams) =>
      await throwOnErr(() =>
        storageServiceClient.patchChannel({
          channel_id: channelId,
          ...request,
        })
      ),
    ...withCallbacks<MessageResponse, Error, PatchChannelParams>(
      {
        onSuccess: async (_data, vars) => {
          queryClient.setQueryData<ApiChannelWithLatest[]>(
            channelKeys.listChannels.queryKey,
            (channels) => updateCachedChannel(channels, vars)
          );
          if (typeof vars.auto_join_team === 'boolean') {
            await invalidateChannelParticipants(vars.channelId);
          }
          toast.success(
            vars.convert_to_team_channel === true
              ? 'Channel converted to a team channel'
              : vars.auto_join_team
                ? 'Team auto-join enabled'
                : 'Team auto-join disabled'
          );
        },
        onError: (error) => {
          console.error('failed to update channel settings', error);
          toast.failure('Failed to update channel settings');
        },
        onSettled: () => void invalidateListChannels(),
      },
      callbacks
    ),
  }));
}
