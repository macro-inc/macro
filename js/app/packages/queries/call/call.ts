import { throwOnErr } from '@core/util/maybeResult';
import { callServiceClient } from '@service-call/client';
import { useMutation } from '@tanstack/solid-query';

export function useJoinCallMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) =>
      await throwOnErr(() => callServiceClient.getOrCreateCall(channelId)),
    onError(error: Error) {
      console.error('failed to join call', error);
    },
  }));
}

export function useLeaveCallMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (channelId: string) =>
      throwOnErr(() => callServiceClient.leaveCall(channelId)),
    onError(error: Error) {
      console.error('failed to leave call', error);
    },
  }));
}
