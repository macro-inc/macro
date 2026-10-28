import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { ChannelAccessDecision } from '@service-storage/generated/schemas/channelAccessDecision';
import type { ChannelAccessRequest } from '@service-storage/generated/schemas/channelAccessRequest';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { invalidateChannelParticipants } from './channel-participants';
import { channelKeys } from './keys';

/** The viewer's own latest request to join a channel they cannot read. */
export function myChannelAccessRequestQueryOptions(channelId: string) {
  return {
    queryKey: channelKeys.myAccessRequest(channelId).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.getMyChannelAccessRequest({
          channel_id: channelId,
        })
      ),
    staleTime: 0,
    refetchOnWindowFocus: 'always' as const,
    // Realtime updates carry answers; polling covers a missed socket frame.
    refetchInterval: 30_000,
    throwOnError: false,
  };
}

export function useMyChannelAccessRequestQuery(
  channelId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    ...myChannelAccessRequestQueryOptions(channelId()),
    enabled: enabled(),
  }));
}

/** A request to join, as shown to the channel's participants. */
export function channelAccessRequestQueryOptions(
  channelId: string,
  requestId: string
) {
  return {
    queryKey: channelKeys.accessRequest(channelId, requestId).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        storageServiceClient.getChannelAccessRequest({
          channel_id: channelId,
          request_id: requestId,
        })
      ),
    throwOnError: false,
  };
}

export function useChannelAccessRequestQuery(
  channelId: Accessor<string>,
  requestId: Accessor<string>
) {
  return useQuery(() =>
    channelAccessRequestQueryOptions(channelId(), requestId())
  );
}

function refreshMyChannelAccessRequest(channelId: string) {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.myAccessRequest(channelId).queryKey,
  });
}

/** Ask to join; replaying a pending request is harmless. */
export function useRequestChannelAccessMutation() {
  return useMutation(() => ({
    mutationFn: ({ channelId }: { channelId: string }) =>
      throwOnErr(() =>
        storageServiceClient.requestChannelAccess({ channel_id: channelId })
      ),
    onError() {
      toast.failure('Could not send your request to join');
    },
    onSettled(_data, _error, { channelId }) {
      return refreshMyChannelAccessRequest(channelId);
    },
  }));
}

/** Withdraw the viewer's pending request. */
export function useCancelChannelAccessRequestMutation() {
  return useMutation(() => ({
    mutationFn: ({ channelId }: { channelId: string }) =>
      throwOnErr(() =>
        storageServiceClient.cancelChannelAccessRequest({
          channel_id: channelId,
        })
      ),
    onError() {
      toast.failure('Could not withdraw your request');
    },
    onSettled(_data, _error, { channelId }) {
      return refreshMyChannelAccessRequest(channelId);
    },
  }));
}

export type ResolveChannelAccessRequestArgs = {
  channelId: string;
  requestId: string;
  decision: ChannelAccessDecision;
};

/** Approve or deny a request as a channel participant. */
export function useResolveChannelAccessRequestMutation() {
  return useMutation(() => ({
    mutationFn: ({
      channelId,
      requestId,
      decision,
    }: ResolveChannelAccessRequestArgs) =>
      throwOnErr(() =>
        storageServiceClient.resolveChannelAccessRequest({
          channel_id: channelId,
          request_id: requestId,
          decision,
        })
      ),
    onSuccess(request: ChannelAccessRequest, { channelId, requestId }) {
      queryClient.setQueryData(
        channelKeys.accessRequest(channelId, requestId).queryKey,
        request
      );
      if (request.status === 'approved')
        return invalidateChannelParticipants(channelId);
    },
    onError(_error, { channelId, requestId }) {
      toast.failure('Could not answer this request');
      // Someone else may have answered first; show their answer.
      return queryClient.invalidateQueries({
        queryKey: channelKeys.accessRequest(channelId, requestId).queryKey,
      });
    },
  }));
}

/** Realtime: a request was made, answered, or withdrawn. */
export function handleChannelAccessRequestChanged(payload: {
  channel_id: string;
  request_id: string;
}) {
  if (
    !payload ||
    typeof payload.channel_id !== 'string' ||
    typeof payload.request_id !== 'string'
  )
    return;
  queryClient.invalidateQueries({
    queryKey: channelKeys.accessRequest(payload.channel_id, payload.request_id)
      .queryKey,
  });
  queryClient.invalidateQueries({
    queryKey: channelKeys.myAccessRequest(payload.channel_id).queryKey,
  });
}

/** Once the viewer is let in, their channel list gains the channel. */
export function refreshJoinedChannel() {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.listChannels.queryKey,
  });
}
