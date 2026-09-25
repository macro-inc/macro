import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type CreateMeetingRequest,
  callServiceClient,
  type UpdateMeetingRequest,
} from '@service-call/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { callKeys } from './keys';

export function useMeetingQuery(shareToken: Accessor<string>) {
  return useQuery(() => ({
    queryKey: callKeys.meeting(shareToken()).queryKey,
    queryFn: () => throwOnErr(() => callServiceClient.getMeeting(shareToken())),
    enabled: shareToken().length > 0,
    retry: false,
  }));
}

export function useInviteMeetingUsersMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (args: { shareToken: string; userIds: string[] }) =>
      throwOnErr(() =>
        callServiceClient.inviteMeetingUsers(args.shareToken, args.userIds)
      ),
  }));
}

export function useMeetingsQuery() {
  return useQuery(() => ({
    queryKey: callKeys.meetings.queryKey,
    queryFn: () => throwOnErr(() => callServiceClient.getMeetings()),
    retry: (count, error) =>
      !thrownResultErrorHasCode(error, 'MEETINGS_UNAVAILABLE') && count < 3,
    refetchOnWindowFocus: (query) =>
      !thrownResultErrorHasCode(query.state.error, 'MEETINGS_UNAVAILABLE'),
  }));
}

export function useCreateMeetingMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (body: CreateMeetingRequest) =>
      throwOnErr(() => callServiceClient.createMeeting(body)),
    onSuccess: () => {
      void queryClient.invalidateQueries(callKeys.meetings);
      void queryClient.invalidateQueries(callKeys.activeMeetings);
    },
  }));
}

export function useActiveMeetingsQuery(userId: Accessor<string | undefined>) {
  return useQuery(() => ({
    queryKey: [...callKeys.activeMeetings.queryKey, userId() ?? ''],
    queryFn: () => throwOnErr(() => callServiceClient.getActiveMeetings()),
    enabled: Boolean(userId()),
    staleTime: 10_000,
    refetchInterval: 15_000,
  }));
}

/** Targeted invite/join events only change the receiving account's live list. */
export function invalidateActiveMeetings(userId: string) {
  return queryClient.invalidateQueries({
    queryKey: [...callKeys.activeMeetings.queryKey, userId],
  });
}

export function fetchMeeting(shareToken: string) {
  return throwOnErr(() => callServiceClient.getMeeting(shareToken));
}

export function useUpdateMeetingMutation() {
  return useMutation(() => ({
    mutationFn: ({
      meetingId,
      ...body
    }: UpdateMeetingRequest & { meetingId: string }) =>
      throwOnErr(() => callServiceClient.updateMeeting(meetingId, body)),
    onSuccess: (meeting) => {
      queryClient.setQueryData(
        callKeys.meeting(meeting.shareToken).queryKey,
        meeting
      );
      void queryClient.invalidateQueries(callKeys.meetings);
      void queryClient.invalidateQueries(callKeys.activeMeetings);
    },
  }));
}

export function useCancelMeetingMutation() {
  return useMutation(() => ({
    mutationFn: (meetingId: string) =>
      throwOnErr(() => callServiceClient.cancelMeeting(meetingId)),
    onSuccess: () => {
      void queryClient.invalidateQueries(callKeys.meetings);
      void queryClient.invalidateQueries(callKeys.activeMeetings);
      // A revoked link must stop rendering as live everywhere: the meeting
      // page holds callKeys.meeting(token) and the copy-link affordances
      // cache callKeys.link(callId) with staleTime: Infinity.
      void queryClient.invalidateQueries({ queryKey: callKeys.meeting._def });
      void queryClient.invalidateQueries({ queryKey: callKeys.link._def });
    },
  }));
}

export function useCallLinkQuery(callId: Accessor<string | undefined>) {
  return useQuery(() => ({
    queryKey: callKeys.link(callId() ?? '').queryKey,
    queryFn: () => throwOnErr(() => callServiceClient.getCallLink(callId()!)),
    enabled: Boolean(callId()),
    staleTime: Infinity,
    retry: false,
  }));
}

export function useJoinMeetingMutation() {
  return useMutation(() => ({
    // RTC credentials are short-lived session state, never persistent query data.
    gcTime: 0,
    mutationFn: (params: { shareToken: string; displayName?: string }) =>
      throwOnErr(() =>
        params.displayName === undefined
          ? callServiceClient.joinMeeting(params.shareToken)
          : callServiceClient.joinMeetingAsGuest(
              params.shareToken,
              params.displayName
            )
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries(callKeys.activeMeetings);
    },
  }));
}

export async function leaveMeeting(shareToken: string, token: string) {
  const result = await throwOnErr(() =>
    callServiceClient.leaveMeeting(shareToken, token)
  );
  void queryClient.invalidateQueries(callKeys.activeMeetings);
  return result;
}
