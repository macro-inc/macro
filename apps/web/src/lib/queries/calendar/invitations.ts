import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import type { InvitationResolution } from '@service-email/generated/schemas/invitationResolution';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys } from './keys';

export type CalendarInvitationsData = Record<string, InvitationResolution>;

/** One bounded batch per thread. Snapshot rendering never waits for this query. */
export function useCalendarInvitationsQuery(threadId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: calendarKeys.invitations(threadId()).queryKey,
    queryFn: () =>
      throwOnErr(() => emailClient.getCalendarInvitations(threadId())),
    staleTime: 15_000,
  }));
}
export function invalidateCalendarInvitations() {
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.invitations._def,
  });
}

/** A loaded thread's saved invitations changed: revalidate its calendar state. */
export function invalidateInvitationScheduling(threadId: string) {
  void queryClient.invalidateQueries({
    queryKey: calendarKeys.invitations(threadId).queryKey,
  });
}

/** Non-suspending fallback after a background refresh fails. */
export function getCachedCalendarInvitations(threadId: string) {
  return queryClient.getQueryData<CalendarInvitationsData>(
    calendarKeys.invitations(threadId).queryKey
  );
}
