import { toast } from '@core/component/Toast/Toast';
import { MaybeResultError, throwOnErr } from '@core/util/maybeResult';
import { queryClient } from '@queries/client';
import { callServiceClient } from '@service-call/client';
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
      if (
        error instanceof MaybeResultError &&
        error.errors[0]?.code === 'CONFLICT'
      ) {
        toast.alert("You're already in another call", {
          subtext: 'Leave your current call before joining a new one.',
        });
        return;
      }
      toast.failure('Failed to join call');
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

export function useToggleShareWithTeamMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (callId: string) =>
      throwOnErr(() => callServiceClient.toggleShareWithTeam(callId)),
    onError(error: Error) {
      console.error('failed to toggle share with team', error);
    },
  }));
}
