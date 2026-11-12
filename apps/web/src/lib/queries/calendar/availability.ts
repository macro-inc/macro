import { useIsAuthenticated } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import type { AvailabilityCalendarsResponse } from '@service-calendar/generated/schemas/availabilityCalendarsResponse';
import { emailClient } from '@service-email/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { AVAILABILITY_CALENDAR_MUTATION_KEY, calendarKeys } from './keys';
import {
  type CachedQuerySnapshot,
  isLastPendingSave,
  replaceCachedQuery,
} from './setting-saves';

function availabilityCalendarsQueryOptions(
  userId: string | undefined,
  authenticated: boolean
) {
  return queryOptions({
    queryKey: calendarKeys.availabilityCalendars(userId ?? '').queryKey,
    queryFn: ({ signal }) =>
      throwOnErr(() => emailClient.getAvailabilityCalendars(signal)),
    enabled: Boolean(userId) && authenticated,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * Whether each of the viewer's calendars counts toward their availability:
 * booking links, team availability and agents all read this one setting.
 */
export function useAvailabilityCalendarsQuery(
  userId: Accessor<string | undefined>
) {
  const authenticated = useIsAuthenticated();
  return useQuery(() =>
    availabilityCalendarsQueryOptions(userId(), authenticated() === true)
  );
}

interface AvailabilityCalendarChange {
  userId: string;
  calendarIds: string[];
  contributesToAvailability: boolean;
}

/**
 * Calendars whose save failed in a group change. The mutation rethrows the
 * client's own error so retry and auth handling still read its codes.
 */
const failedCalendarIds = new WeakMap<AvailabilityCalendarChange, string[]>();

const availabilityCalendarMutationOptions = {
  mutationKey: AVAILABILITY_CALENDAR_MUTATION_KEY,
  scope: { id: 'calendar-availability-calendar' },
  mutationFn: async (change: AvailabilityCalendarChange) => {
    // Settle every request before reconciling, so no save can land after the
    // refetch that follows a failure.
    const results = await Promise.allSettled(
      change.calendarIds.map((calendarId) =>
        throwOnErr(() =>
          emailClient.setAvailabilityCalendar(calendarId, {
            contributesToAvailability: change.contributesToAvailability,
          })
        )
      )
    );
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ calendarId: change.calendarIds[index], reason: result.reason }]
        : []
    );
    if (failures.length === 0) return;
    failedCalendarIds.set(
      change,
      failures.map((failure) => failure.calendarId)
    );
    throw failures[0].reason;
  },
  onMutate: ({
    userId,
    calendarIds,
    contributesToAvailability,
  }: AvailabilityCalendarChange) =>
    replaceCachedQuery<AvailabilityCalendarsResponse>(
      calendarKeys.availabilityCalendars(userId).queryKey,
      (current) => ({
        calendars: current.calendars.map((calendar) =>
          calendarIds.includes(calendar.calendarId)
            ? { ...calendar, contributesToAvailability }
            : calendar
        ),
      })
    ),
  onError: (
    _error: unknown,
    change: AvailabilityCalendarChange,
    snapshot: CachedQuerySnapshot<AvailabilityCalendarsResponse> | undefined
  ) => {
    const previous = snapshot?.previous;
    if (!previous || !isLastPendingSave(AVAILABILITY_CALENDAR_MUTATION_KEY))
      return;
    const failed = new Set(failedCalendarIds.get(change) ?? change.calendarIds);
    const before = new Map(
      previous.calendars.map((calendar) => [calendar.calendarId, calendar])
    );
    queryClient.setQueryData<AvailabilityCalendarsResponse>(
      calendarKeys.availabilityCalendars(change.userId).queryKey,
      (current) =>
        current && {
          calendars: current.calendars.map((calendar) =>
            failed.has(calendar.calendarId)
              ? (before.get(calendar.calendarId) ?? calendar)
              : calendar
          ),
        }
    );
  },
  onSettled: (
    _data: unknown,
    _error: unknown,
    { userId }: AvailabilityCalendarChange
  ) =>
    isLastPendingSave(AVAILABILITY_CALENDAR_MUTATION_KEY)
      ? queryClient.invalidateQueries({
          queryKey: calendarKeys.availabilityCalendars(userId).queryKey,
        })
      : undefined,
};

/** Shows a change at once and restores only the calendars whose save failed. */
export function useSetAvailabilityCalendarMutation() {
  return useMutation(() => availabilityCalendarMutationOptions);
}
