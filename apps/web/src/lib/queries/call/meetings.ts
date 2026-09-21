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

export function useInviteToMeetingMutation() {
  return useMutation(() => ({
    mutationFn: (args: { shareToken: string; email: string }) =>
      throwOnErr(() =>
        callServiceClient.inviteToMeeting(args.shareToken, args.email)
      ),
  }));
}

export function useMeetingsQuery(options?: {
  refetchInterval?: number | false;
}) {
  return useQuery(() => ({
    queryKey: callKeys.meetings.queryKey,
    queryFn: () => throwOnErr(() => callServiceClient.getMeetings()),
    retry: (count, error) =>
      !thrownResultErrorHasCode(error, 'MEETINGS_UNAVAILABLE') && count < 3,
    refetchInterval: (query) =>
      thrownResultErrorHasCode(query.state.error, 'MEETINGS_UNAVAILABLE')
        ? false
        : options?.refetchInterval,
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
    },
  }));
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
    },
  }));
}

export function useCancelMeetingMutation() {
  return useMutation(() => ({
    mutationFn: (meetingId: string) =>
      throwOnErr(() => callServiceClient.cancelMeeting(meetingId)),
    onSuccess: () => {
      void queryClient.invalidateQueries(callKeys.meetings);
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

export function fetchCallLink(callId: string) {
  return queryClient.fetchQuery({
    queryKey: callKeys.link(callId).queryKey,
    queryFn: () => throwOnErr(() => callServiceClient.getCallLink(callId)),
    staleTime: Infinity,
  });
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
  }));
}

export function leaveMeeting(shareToken: string, token: string) {
  return throwOnErr(() => callServiceClient.leaveMeeting(shareToken, token));
}
