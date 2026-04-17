import { throwOnErr } from '@core/util/maybeResult';
import { callServiceClient } from '@service-call/client';
import { queryClient } from '@queries/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export function useActiveCallQuery(channelId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: ['call', 'active', channelId()],
    queryFn: async () =>
      await throwOnErr(() => callServiceClient.checkActiveCall(channelId())),
    refetchInterval: 15_000,
  }));
}

export function useJoinCallMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) =>
      await throwOnErr(() => callServiceClient.getOrCreateCall(channelId)),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ['call', 'active'] });
    },
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
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ['call', 'active'] });
    },
    onError(error: Error) {
      console.error('failed to leave call', error);
    },
  }));
}

export function useCallRecordQuery(callId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: ['call', 'record', callId()],
    queryFn: async () =>
      await throwOnErr(() => callServiceClient.getCallRecord(callId())),
  }));
}
