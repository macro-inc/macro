import type { CalendarSharing } from '@app/features/calendar-team/core/model';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { AvailabilityCalendarsResponse } from '@service-calendar/generated/schemas/availabilityCalendarsResponse';
import type { TeamCalendarSharingBody } from '@service-calendar/generated/schemas/teamCalendarSharingBody';
import { emailClient } from '@service-email/client';
import { type QueryKey, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { ensureTeamCalendarExpiry } from './team-cache';
import {
  type CalendarTeamIdentity,
  calendarTeamKeys,
  calendarTeamMutationKeys,
} from './team-keys';

const REFRESH_INTERVAL = 30_000;
const freshness = {
  staleTime: 0,
  gcTime: 0,
  refetchInterval: REFRESH_INTERVAL,
  refetchOnWindowFocus: true,
  refetchOnReconnect: 'always' as const,
};

/** A viewer-scoped roster read avoids the legacy current-team singleton cache. */
export function useCalendarTeamIdentityQuery(
  userId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  ensureTeamCalendarExpiry();
  return useQuery(() => ({
    queryKey: calendarTeamKeys.identity(userId() ?? '').queryKey,
    queryFn: () => throwOnErr(() => authServiceClient.getTeam()),
    enabled: Boolean(userId()) && enabled(),
    ...freshness,
  }));
}

export function useTeamCalendarSharingQuery(
  identity: Accessor<CalendarTeamIdentity | undefined>
) {
  return useQuery(() => ({
    queryKey: calendarTeamKeys.sharing(identity()).queryKey,
    queryFn: ({ signal }) =>
      throwOnErr(() => emailClient.getTeamCalendarSharing(signal)),
    enabled: identity() !== undefined,
    ...freshness,
  }));
}

export function useAvailabilityCalendarsQuery(
  identity: Accessor<CalendarTeamIdentity | undefined>
) {
  return useQuery(() => ({
    queryKey: calendarTeamKeys.availabilityCalendars(identity()).queryKey,
    queryFn: ({ signal }) =>
      throwOnErr(() => emailClient.getAvailabilityCalendars(signal)),
    enabled: identity() !== undefined,
    ...freshness,
  }));
}

/** Update one cached query now and restore it if the save fails; never blank it. */
interface CachedQuerySnapshot<T> {
  previous: T | undefined;
}

async function replaceCachedQuery<T>(
  queryKey: QueryKey,
  update: (current: T) => T
): Promise<CachedQuerySnapshot<T>> {
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData<T>(queryKey);
  if (previous !== undefined)
    queryClient.setQueryData<T>(queryKey, update(previous));
  return { previous };
}

/**
 * Saves of one setting share a scope, so their requests reach the server in
 * order. Only the last pending save rolls back or refetches; an earlier one
 * would overwrite the newer optimistic choice.
 */
const isLastPendingSave = (mutationKey: QueryKey) =>
  queryClient.isMutating({ mutationKey }) === 1;

const teamSharingMutationKey = calendarTeamMutationKeys.sharing;

interface TeamSharingChange {
  identity: CalendarTeamIdentity;
  sharing: CalendarSharing;
}

const teamSharingMutationOptions = {
  mutationKey: teamSharingMutationKey,
  scope: { id: 'calendar-team-sharing' },
  mutationFn: ({ sharing }: TeamSharingChange) =>
    throwOnErr(() => emailClient.setTeamCalendarSharing({ sharing })),
  onMutate: ({ identity, sharing }: TeamSharingChange) =>
    replaceCachedQuery<TeamCalendarSharingBody>(
      calendarTeamKeys.sharing(identity).queryKey,
      () => ({ sharing })
    ),
  onError: (
    _error: unknown,
    { identity }: TeamSharingChange,
    snapshot: CachedQuerySnapshot<TeamCalendarSharingBody> | undefined
  ) => {
    if (snapshot?.previous && isLastPendingSave(teamSharingMutationKey))
      queryClient.setQueryData(
        calendarTeamKeys.sharing(identity).queryKey,
        snapshot.previous
      );
  },
  onSettled: (
    _data: unknown,
    _error: unknown,
    { identity }: TeamSharingChange
  ) =>
    isLastPendingSave(teamSharingMutationKey)
      ? queryClient.invalidateQueries({
          queryKey: calendarTeamKeys.sharing(identity).queryKey,
        })
      : undefined,
};

/** The viewer's own sharing never changes what they can read, so nothing else resets. */
export function useSetTeamCalendarSharingMutation() {
  return useMutation(() => teamSharingMutationOptions);
}

const availabilityCalendarMutationKey =
  calendarTeamMutationKeys.availabilityCalendar;

interface AvailabilityCalendarChange {
  identity: CalendarTeamIdentity;
  calendarIds: string[];
  contributesToAvailability: boolean;
}

/**
 * Calendars whose save failed in a group change. The mutation rethrows the
 * client's own error so retry and auth handling still read its codes.
 */
const failedCalendarIds = new WeakMap<AvailabilityCalendarChange, string[]>();

const availabilityCalendarMutationOptions = {
  mutationKey: availabilityCalendarMutationKey,
  scope: { id: 'calendar-team-availability-calendar' },
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
    identity,
    calendarIds,
    contributesToAvailability,
  }: AvailabilityCalendarChange) =>
    replaceCachedQuery<AvailabilityCalendarsResponse>(
      calendarTeamKeys.availabilityCalendars(identity).queryKey,
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
    if (!previous || !isLastPendingSave(availabilityCalendarMutationKey))
      return;
    const failed = new Set(failedCalendarIds.get(change) ?? change.calendarIds);
    const before = new Map(
      previous.calendars.map((calendar) => [calendar.calendarId, calendar])
    );
    queryClient.setQueryData<AvailabilityCalendarsResponse>(
      calendarTeamKeys.availabilityCalendars(change.identity).queryKey,
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
    { identity }: AvailabilityCalendarChange
  ) =>
    isLastPendingSave(availabilityCalendarMutationKey)
      ? queryClient.invalidateQueries({
          queryKey: calendarTeamKeys.availabilityCalendars(identity).queryKey,
        })
      : undefined,
};

/** Group changes save every calendar of an account in one optimistic step. */
export function useSetAvailabilityCalendarMutation() {
  return useMutation(() => availabilityCalendarMutationOptions);
}
