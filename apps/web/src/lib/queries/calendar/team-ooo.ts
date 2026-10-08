import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { type CalendarOccurrenceQueryRange, calendarKeys } from './keys';
import { useCalendarTeamIdentityQuery } from './team';

const TEAM_OOO_PAGE_SIZE = 2000;

export interface TeamOutOfOfficeQueryInput {
  userId: string | undefined;
  range: CalendarOccurrenceQueryRange | undefined;
}

export interface TeamOutOfOfficeQueryOptions {
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
}

/** Fetches teammates' out-of-office occurrences for one viewport. */
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
  return response.items;
}

// Cached callbacks close over the resolved range and flags only.
function teamOutOfOfficeQueryOptions(
  userId: string | undefined,
  range: CalendarOccurrenceQueryRange | undefined,
  teamId: string | undefined,
  enabled: boolean,
  refetchOnWindowFocus: boolean
) {
  return queryOptions({
    queryKey: calendarKeys.teamOutOfOffice(userId ?? '', range, teamId)
      .queryKey,
    queryFn: ({ signal }) => {
      if (!range) {
        throw new Error('Team out-of-office range is unavailable');
      }

      return fetchTeamOutOfOffice(range, signal);
    },
    enabled:
      Boolean(userId) && Boolean(teamId) && range !== undefined && enabled,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
    refetchOnReconnect: 'always',
    refetchOnWindowFocus,
  });
}

export function useTeamOutOfOfficeQuery(
  input: Accessor<TeamOutOfOfficeQueryInput>,
  options?: Accessor<TeamOutOfOfficeQueryOptions>
) {
  const identity = useCalendarTeamIdentityQuery(
    () => input().userId,
    () => options?.().enabled !== false
  );
  return useQuery(() => {
    const { userId, range } = input();
    const opts = options?.();
    const team =
      identity.isSuccess && !identity.isPaused ? identity.data : undefined;
    const teamId = team?.members.some((member) => member.user_id === userId)
      ? team.team.id
      : undefined;

    return teamOutOfOfficeQueryOptions(
      userId,
      range,
      teamId,
      opts?.enabled !== false,
      opts?.refetchOnWindowFocus ?? true
    );
  });
}

export function invalidateTeamOutOfOffice() {
  return queryClient.invalidateQueries({
    queryKey: calendarKeys.teamOutOfOffice._def,
  });
}
