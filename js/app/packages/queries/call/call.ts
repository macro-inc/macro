import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type CallRecord, callServiceClient } from '@service-call/client';
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

function _useJoinCallMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) =>
      await throwOnErr(() => callServiceClient.getOrCreateCall(channelId)),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ['call', 'active'] });
    },
    onError(error: Error) {
      if (
        error instanceof ThrownResultError &&
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

function isNotFoundResultError(error: unknown) {
  return (
    error instanceof ThrownResultError &&
    error.errors.some((err) => err.code === 'NOT_FOUND')
  );
}

export function useLeaveCallMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) => {
      try {
        return await throwOnErr(() => callServiceClient.leaveCall(channelId));
      } catch (error) {
        // Leaving a call should be idempotent. If LiveKit/server cleanup already
        // removed us, the UI should still finish disconnecting instead of
        // surfacing a noisy "Resource not found" control failure.
        if (isNotFoundResultError(error)) return undefined;
        throw error;
      }
    },
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

export function setCallRecordShareWithTeamCache(
  callId: string,
  shareWithTeam: boolean
) {
  queryClient.setQueryData<CallRecord>(['call', 'record', callId], (prev) => {
    if (!prev) return prev;
    return { ...prev, shareWithTeam };
  });
}

function invalidateCallRecord(callId: string) {
  queryClient.invalidateQueries({ queryKey: ['call', 'record', callId] });
}

export function useSetCallRecordShareWithTeamMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (params: { callId: string; shareWithTeam: boolean }) => {
      await throwOnErr(() => callServiceClient.editCallRecord(params));
      return params;
    },
    onSuccess({ callId, shareWithTeam }) {
      setCallRecordShareWithTeamCache(callId, shareWithTeam);
      invalidateCallRecord(callId);
    },
    onError(error: Error) {
      console.error('failed to set share with team', error);
    },
  }));
}

export function useToggleShareWithTeamMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (callId: string) =>
      throwOnErr(() => callServiceClient.toggleShareWithTeam(callId)),
    onSuccess(newValue, callId) {
      setCallRecordShareWithTeamCache(callId, newValue);
      invalidateCallRecord(callId);
    },
    onError(error: Error) {
      console.error('failed to toggle share with team', error);
    },
  }));
}
