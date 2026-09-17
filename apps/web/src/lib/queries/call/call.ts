import { toast } from '@core/component/Toast/Toast';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type CallRecord, callServiceClient } from '@service-call/client';
import type { ActiveCallSummary } from '@service-storage/generated/schemas/activeCallSummary';
import type { CallActiveResponse } from '@service-storage/generated/schemas/callActiveResponse';
import type { SharePermissionV2 } from '@service-storage/generated/schemas/sharePermissionV2';
import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { callKeys } from './keys';

export function useActiveCallQuery(channelId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: callKeys.active(channelId()).queryKey,
    queryFn: async () =>
      await throwOnErr(() => callServiceClient.checkActiveCall(channelId())),
    placeholderData: null,
    refetchInterval: 15_000,
  }));
}

/**
 * All active calls in channels the user is a member of, newest first. One
 * request app-wide; the websocket
 * call_started/call_ended handlers keep it live.
 */
export function useActiveCallsQuery() {
  return useQuery(() => ({
    queryKey: callKeys.allActive.queryKey,
    queryFn: async () =>
      await throwOnErr(() => callServiceClient.getActiveCalls()),
    placeholderData: [] as ActiveCallSummary[],
    refetchInterval: 30_000,
    enabled: ENABLE_CALLS,
  }));
}

export function setActiveCallStartedCache(call: CallActiveResponse) {
  queryClient.setQueryData<CallActiveResponse | null>(
    callKeys.active(call.channelId).queryKey,
    call
  );

  queryClient.setQueryData<ActiveCallSummary[]>(
    callKeys.allActive.queryKey,
    (prev) => {
      if (!prev) return prev;
      const withoutDuplicate = prev.filter(
        (activeCall) =>
          activeCall.callId !== call.callId &&
          activeCall.channelId !== call.channelId
      );
      // The websocket event carries no count; the creator is in the call.
      return [{ ...call, participantCount: 1 }, ...withoutDuplicate].sort(
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

  queryClient.setQueryData<ActiveCallSummary[]>(
    callKeys.allActive.queryKey,
    (prev) =>
      prev?.filter(
        (call) =>
          call.callId !== params.callId && call.channelId !== params.channelId
      )
  );
}

export function invalidateActiveCallQueries() {
  return queryClient.invalidateQueries({ queryKey: callKeys.active._def });
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
    // The call block's load() primes this cache; a stale time keeps that
    // primed record from triggering an immediate duplicate fetch on mount.
    // Mutations still invalidate, so sharing edits stay reactive.
    staleTime: 60_000,
    enabled: callId().length > 0,
  }));
}

export function fetchCallRecord(
  callId: string,
  staleTimeMs: number
): Promise<CallRecord> {
  return queryClient.fetchQuery({
    queryKey: callKeys.record(callId).queryKey,
    queryFn: async () =>
      await throwOnErr(() => callServiceClient.getCallRecord(callId)),
    staleTime: staleTimeMs,
  });
}

/**
 * Whether a call is shared with its creator's team: the pending toggle while
 * the call is live, the canonical `view` grant once it is archived.
 */
export function isCallSharedWithTeam(record: CallRecord): boolean {
  return record.shareWithTeam;
}

/**
 * Share-modal view of a call record. Live calls only have the pending
 * `shareWithTeam` toggle; archived calls mirror that on
 * `teamShareAccessLevel` as `view`.
 */
export function sharePermissionFromCallRecord(
  record: CallRecord
): SharePermissionV2 {
  return {
    id: record.callId,
    owner: record.createdBy,
    teamShareAccessLevel: isCallSharedWithTeam(record) ? 'view' : null,
  };
}

export function fetchCallSharePermission(callId: string) {
  return callServiceClient
    .getCallRecord(callId)
    .then((result) => result.map(sharePermissionFromCallRecord));
}

/** The `sharePermission` patch that shares a call with the team, or revokes it. */
export function buildCallTeamSharePayload(
  shared: boolean
): Pick<UpdateSharePermissionRequestV2, 'teamShareAccessLevel'> {
  return { teamShareAccessLevel: shared ? 'view' : null };
}

export function updateCallTeamShare(callId: string, shared: boolean) {
  return callServiceClient.editCallRecord({
    callId,
    sharePermission: buildCallTeamSharePayload(shared),
  });
}

function patchCachedCallTeamShare(
  record: CallRecord,
  shared: boolean
): CallRecord {
  return {
    ...record,
    shareWithTeam: shared,
    teamShareAccessLevel: record.isActive
      ? record.teamShareAccessLevel
      : buildCallTeamSharePayload(shared).teamShareAccessLevel,
  };
}

export function setCallRecordTeamShareCache(callId: string, shared: boolean) {
  const queryKey = callKeys.record(callId).queryKey;
  // Drop in-flight GETs so a slower record response cannot overwrite this write.
  void queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<CallRecord>(queryKey, (prev) =>
    prev ? patchCachedCallTeamShare(prev, shared) : prev
  );
}

function invalidateCallRecord(callId: string) {
  queryClient.invalidateQueries({ queryKey: callKeys.record(callId).queryKey });
}

/**
 * Flip the live call's share-with-team toggle. Any participant with edit
 * access may do this; the toggle is applied as canonical team sharing when
 * the call is archived.
 */
export function useToggleShareWithTeamMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (callId: string) =>
      throwOnErr(() => callServiceClient.toggleShareWithTeam(callId)),
    onSuccess(newValue, callId) {
      setCallRecordTeamShareCache(callId, newValue);
      invalidateCallRecord(callId);
    },
    onError(error: Error) {
      console.error('failed to toggle share with team', error);
    },
  }));
}

/**
 * Share an archived call with the creator's team, or revoke it. Only the
 * creator may change this; the backend answers 403 otherwise.
 */
export function useSetCallRecordTeamShareMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (params: { callId: string; shared: boolean }) => {
      await throwOnErr(() => updateCallTeamShare(params.callId, params.shared));
      return params;
    },
    onSuccess({ callId, shared }) {
      setCallRecordTeamShareCache(callId, shared);
      invalidateCallRecord(callId);
    },
    onError(error: Error) {
      console.error('failed to update call team sharing', error);
    },
  }));
}
