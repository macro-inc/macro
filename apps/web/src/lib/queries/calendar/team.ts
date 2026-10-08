import type { CalendarSharing } from '@app/features/calendar-team/core/model';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import type { TeamCalendarPage } from '@service-storage/generated/schemas/teamCalendarPage';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { CalendarOccurrenceQueryRange } from './keys';
import {
  ensureTeamCalendarExpiry,
  resetTeamCalendarQueries,
} from './team-cache';
import { type CalendarTeamIdentity, calendarTeamKeys } from './team-keys';

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

/** Read every page. A failed or cyclic continuation never looks like empty time. */
export async function fetchTeamCalendar(
  range: CalendarOccurrenceQueryRange,
  signal?: AbortSignal
): Promise<TeamCalendarPage> {
  const items = new Map<string, TeamCalendarPage['items'][number]>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let members: TeamCalendarPage['members'] = [];
  do {
    const page = await throwOnErr(() =>
      storageServiceClient.listTeamCalendar({
        start: range.start,
        end: range.end,
        limit: 500,
        cursor,
        signal,
      })
    );
    members = page.members;
    for (const item of page.items)
      items.set(JSON.stringify([item.ownerId, item.id]), item);
    if (!page.nextCursor) break;
    if (cursors.has(page.nextCursor))
      throw new Error('Team calendar returned a repeated cursor');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
  return { members, items: [...items.values()], nextCursor: null };
}

export function useTeamCalendarQuery(
  identity: Accessor<CalendarTeamIdentity | undefined>,
  range: Accessor<CalendarOccurrenceQueryRange | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    queryKey: calendarTeamKeys.events(identity(), range()).queryKey,
    queryFn: ({ signal }) => {
      const current = range();
      if (!current) throw new Error('Calendar range unavailable');
      return fetchTeamCalendar(current, signal);
    },
    enabled: identity() !== undefined && range() !== undefined && enabled(),
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

/** A zero-limit read authorizes the roster without scanning source events. */
export async function fetchTeamCalendarMembers(signal?: AbortSignal) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const page = await throwOnErr(() =>
    storageServiceClient.listTeamCalendar({
      start: start.toISOString(),
      end: end.toISOString(),
      limit: 0,
      signal,
    })
  );
  return page.members;
}

/** The roster is present even in an empty viewport; retain no event payload. */
export function useTeamCalendarMembersQuery(
  identity: Accessor<CalendarTeamIdentity | undefined>
) {
  return useQuery(() => ({
    queryKey: calendarTeamKeys.members(identity()).queryKey,
    queryFn: ({ signal }) => fetchTeamCalendarMembers(signal),
    enabled: identity() !== undefined,
    ...freshness,
  }));
}

export function useSetTeamCalendarSharingMutation() {
  return useMutation(() => ({
    mutationFn: (sharing: CalendarSharing) =>
      throwOnErr(() => emailClient.setTeamCalendarSharing({ sharing })),
    onSuccess: resetTeamCalendarQueries,
  }));
}

export function useSetAvailabilityCalendarMutation() {
  return useMutation(() => ({
    mutationFn: (args: {
      calendarId: string;
      contributesToAvailability: boolean;
    }) =>
      throwOnErr(() =>
        emailClient.setAvailabilityCalendar(args.calendarId, {
          contributesToAvailability: args.contributesToAvailability,
        })
      ),
    onSuccess: resetTeamCalendarQueries,
  }));
}
