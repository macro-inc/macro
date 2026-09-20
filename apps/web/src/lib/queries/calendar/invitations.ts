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
  enabled: Accessor<boolean>,
  offset: Accessor<number> = () => 0
) {
  return useQuery(() => ({
    queryKey: calendarKeys.invitations(threadId(), offset()).queryKey,
    queryFn: () =>
      throwOnErr(() =>
        emailClient.getCalendarInvitations(threadId(), offset())
      ),
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

let stopDeferredSchedulingRefresh: (() => void) | undefined;

/** Scheduling changed: withdraw stale capabilities without overwriting an in-flight RSVP. */
export async function invalidateInvitationScheduling() {
  await queryClient.cancelQueries({ queryKey: calendarKeys.invitations._def });
  queryClient.setQueriesData<CalendarInvitationsData>(
    { queryKey: calendarKeys.invitations._def },
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
  const responding =
    queryClient.isMutating({ mutationKey: RSVP_MUTATION_KEY }) > 0;
  if (responding && !stopDeferredSchedulingRefresh) {
    // A change can arrive during onSettled, after its revalidation has started.
    // Drain after the mutation actually completes, including that interval.
    stopDeferredSchedulingRefresh = queryClient
      .getMutationCache()
      .subscribe(() => {
        if (queryClient.isMutating({ mutationKey: RSVP_MUTATION_KEY }) > 0)
          return;
        stopDeferredSchedulingRefresh?.();
        stopDeferredSchedulingRefresh = undefined;
        void invalidateCalendarInvitations();
      });
  }
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.invitations._def,
    refetchType: responding ? 'none' : 'active',
  });
}

/** Non-suspending fallback after a background refresh fails. */
export function getCachedCalendarInvitations(threadId: string, offset: number) {
  return queryClient.getQueryData<CalendarInvitationsData>(
    calendarKeys.invitations(threadId, offset).queryKey
  );
}
