import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import type { InvitationResolution } from '@service-email/generated/schemas/invitationResolution';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys, RSVP_MUTATION_KEY } from './keys';

export type CalendarInvitationsData = Record<string, InvitationResolution>;

/** One bounded batch per thread. Snapshot rendering never waits for this query. */
export function useCalendarInvitationsQuery(
  threadId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    queryKey: calendarKeys.invitations(threadId()).queryKey,
    queryFn: () =>
      throwOnErr(() => emailClient.getCalendarInvitations(threadId())),
    enabled: enabled(),
    staleTime: 15_000,
    refetchOnReconnect: true,
  }));
}
export function invalidateCalendarInvitations() {
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.invitations._def,
  });
}

/** A thread's saved invitations changed: withdraw its actions, then revalidate. */
export function invalidateInvitationScheduling(threadId: string) {
  const { queryKey } = calendarKeys.invitations(threadId);
  queryClient.setQueryData<CalendarInvitationsData>(
    queryKey,
    (previous) =>
      previous &&
      Object.fromEntries(
        Object.entries(previous).map(([id, value]) => [
          id,
          value.kind === 'resolved'
            ? { ...value, can_respond: false, can_join: false }
            : value,
        ])
      )
  );
  // An in-flight RSVP revalidates every invitation lookup when it settles.
  if (queryClient.isMutating({ mutationKey: RSVP_MUTATION_KEY }) > 0) return;
  void queryClient.invalidateQueries({ queryKey });
}

/** Non-suspending fallback after a background refresh fails. */
export function getCachedCalendarInvitations(threadId: string) {
  return queryClient.getQueryData<CalendarInvitationsData>(
    calendarKeys.invitations(threadId).queryKey
  );
}
