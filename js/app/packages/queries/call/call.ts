import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type CallRecord, callServiceClient } from '@service-call/client';
import type { CallActiveResponse } from '@service-storage/generated/schemas/callActiveResponse';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { callKeys } from './keys';

export function useActiveCallQuery(channelId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: callKeys.active(channelId()).queryKey,
    queryFn: async () =>
      await throwOnErr(() => callServiceClient.checkActiveCall(channelId())),
    refetchInterval: 15_000,
  }));
}

export function useActiveCallsForChannelsQuery(channelIds: Accessor<string[]>) {
  return useQuery(() => {
    const ids = [...new Set(channelIds())].sort();

    return {
      queryKey: callKeys.activeChannels(ids).queryKey,
      queryFn: async (): Promise<CallActiveResponse[]> => {
        const activeCalls = await Promise.all(
          ids.map(async (channelId) =>
            throwOnErr(() => callServiceClient.checkActiveCall(channelId))
          )
        );

        return activeCalls
          .filter((call): call is CallActiveResponse => call !== null)
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
      },
      refetchInterval: 15_000,
      enabled: ids.length > 0,
    };
  });
}

export function setActiveCallStartedCache(call: CallActiveResponse) {
  queryClient.setQueryData<CallActiveResponse | null>(
    callKeys.active(call.channelId).queryKey,
    call
  );

  queryClient.setQueriesData<CallActiveResponse[]>(
    { queryKey: callKeys.activeChannels._def },
    (prev) => {
      if (!prev) return prev;
      const withoutDuplicate = prev.filter(
        (activeCall) =>
          activeCall.callId !== call.callId &&
          activeCall.channelId !== call.channelId
      );
      return [call, ...withoutDuplicate].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
  );
}

export function setActiveCallEndedCache(params: {
  callId: string;
  channelId: string;
}) {
  queryClient.setQueryData<CallActiveResponse | null>(
    callKeys.active(params.channelId).queryKey,
    null
  );

  queryClient.setQueriesData<CallActiveResponse[]>(
    { queryKey: callKeys.activeChannels._def },
    (prev) =>
      prev?.filter(
        (call) =>
          call.callId !== params.callId && call.channelId !== params.channelId
      )
  );
}

export function invalidateActiveCallQueries() {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: callKeys.active._def }),
    queryClient.invalidateQueries({ queryKey: callKeys.activeChannels._def }),
  ]);
}

function _useJoinCallMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) =>
      await throwOnErr(() => callServiceClient.getOrCreateCall(channelId)),
    onSuccess() {
      invalidateActiveCallQueries();
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
      invalidateActiveCallQueries();
    },
    onError(error: Error) {
      console.error('failed to leave call', error);
    },
  }));
}

export function useCallRecordQuery(callId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: callKeys.record(callId()).queryKey,
    queryFn: async () =>
      await throwOnErr(() => callServiceClient.getCallRecord(callId())),
  }));
}

export function setCallRecordShareWithTeamCache(
  callId: string,
  shareWithTeam: boolean
) {
  queryClient.setQueryData<CallRecord>(
    callKeys.record(callId).queryKey,
    (prev) => {
      if (!prev) return prev;
      return { ...prev, shareWithTeam };
    }
  );
}

function invalidateCallRecord(callId: string) {
  queryClient.invalidateQueries({ queryKey: callKeys.record(callId).queryKey });
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
