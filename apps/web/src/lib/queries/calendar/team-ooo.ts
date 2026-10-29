import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { focusManager, queryOptions, useQueries } from '@tanstack/solid-query';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { type CalendarOccurrenceQueryRange, calendarKeys } from './keys';
import { useCalendarTeamIdentityQuery } from './team';

const TEAM_OOO_PAGE_SIZE = 2000;
const TEAM_OOO_POLL_INTERVAL = 30_000;

export interface TeamOutOfOfficeQueriesInput {
  userId: string | undefined;
  ranges: readonly CalendarOccurrenceQueryRange[];
}

export interface TeamOutOfOfficeQueryOptions {
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
}

/** The viewport's two halves by local date, or none for a single day. */
function splitRange(
  range: CalendarOccurrenceQueryRange
): [CalendarOccurrenceQueryRange, CalendarOccurrenceQueryRange] | undefined {
  const start = parseISO(range.startDate);
  const days = differenceInCalendarDays(parseISO(range.endDate), start);
  if (days < 2) return undefined;
  const middle = addDays(start, Math.floor(days / 2));
  const at = middle.toISOString();
  const date = format(middle, 'yyyy-MM-dd');
  return [
    { ...range, end: at, endDate: date },
    { ...range, start: at, startDate: date },
  ];
}

/**
 * Fetches teammates' out-of-office occurrences for one viewport. A viewport
 * with more than one page of them splits in half until each part fits, so a
 * busy team's later occurrences are not cut off.
 */
export async function fetchTeamOutOfOffice(
  range: CalendarOccurrenceQueryRange,
  signal?: AbortSignal
): Promise<TeamOutOfOfficeItem[]> {
  const response = await throwOnErr(() =>
    storageServiceClient.listTeamOutOfOffice({
      ...range,
      limit: TEAM_OOO_PAGE_SIZE,
      signal,
    })
  );
  const halves = response.hasMore ? splitRange(range) : undefined;
  if (!halves) return response.items;
  const parts = await Promise.all(
    halves.map((half) => fetchTeamOutOfOffice(half, signal))
  );
  // An occurrence that spans the split comes back from both halves.
  const byOccurrence = new Map(
    parts
      .flat()
      .map((item) => [JSON.stringify([item.eventId, item.occurrenceKey]), item])
  );
  return [...byOccurrence.values()];
}

// Cached callbacks close over the resolved range and flags only.
function teamOutOfOfficeQueryOptions(
  userId: string | undefined,
  range: CalendarOccurrenceQueryRange,
  teamId: string | undefined,
  enabled: boolean,
  refetchOnWindowFocus: boolean
) {
  return queryOptions({
    queryKey: calendarKeys.teamOutOfOffice(userId ?? '', range, teamId)
      .queryKey,
    queryFn: ({ signal }) => fetchTeamOutOfOffice(range, signal),
    enabled: Boolean(userId) && Boolean(teamId) && enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus,
  });
}

let pollInstalled = false;

/**
 * Polls every mounted out-of-office range once per interval. TanStack runs
 * `refetchInterval` per observer, and the calendar's pages and its sidebar
 * observe the same ranges, so per-query intervals would fetch each range once
 * per observer. Like `refetchInterval`, it waits while the window is hidden.
 */
function ensureTeamOutOfOfficePolling() {
  if (pollInstalled) return;
  pollInstalled = true;
  setInterval(() => {
    if (!focusManager.isFocused()) return;
    queryClient.invalidateQueries(
      { queryKey: calendarKeys.teamOutOfOffice._def },
      { cancelRefetch: false }
    );
  }, TEAM_OOO_POLL_INTERVAL);
}

/** One query per range; observers of the same range share its request. */
export function useTeamOutOfOfficeQueries(
  input: Accessor<TeamOutOfOfficeQueriesInput>,
  options?: Accessor<TeamOutOfOfficeQueryOptions>
) {
  ensureTeamOutOfOfficePolling();
  const identity = useCalendarTeamIdentityQuery(
    () => input().userId,
    () => options?.().enabled !== false
  );
  return useQueries(() => {
    const { userId, ranges } = input();
    const opts = options?.();
    const team =
      identity.isSuccess && !identity.isPaused ? identity.data : undefined;
    const teamId = team?.members.some((member) => member.user_id === userId)
      ? team.team.id
      : undefined;

    return {
      queries: ranges.map((range) =>
        teamOutOfOfficeQueryOptions(
          userId,
          range,
          teamId,
          opts?.enabled !== false,
          opts?.refetchOnWindowFocus ?? true
        )
      ),
    };
  });
}
