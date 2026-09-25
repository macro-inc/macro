import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { type CalendarOccurrenceQueryRange, calendarKeys } from './keys';

const TEAM_OOO_PAGE_SIZE = 2000;
const TEAM_OOO_STALE_TIME = 60_000;

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
  enabled: boolean,
  refetchOnWindowFocus: boolean
) {
  return queryOptions({
    queryKey: calendarKeys.teamOutOfOffice(userId ?? '', range).queryKey,
    queryFn: ({ signal }) => {
      if (!range) {
        throw new Error('Team out-of-office range is unavailable');
      }

      return fetchTeamOutOfOffice(range, signal);
    },
    enabled: Boolean(userId) && range !== undefined && enabled,
    staleTime: TEAM_OOO_STALE_TIME,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus,
  });
}

export function useTeamOutOfOfficeQuery(
  input: Accessor<TeamOutOfOfficeQueryInput>,
  options?: Accessor<TeamOutOfOfficeQueryOptions>
) {
  return useQuery(() => {
    const { userId, range } = input();
    const opts = options?.();

    return teamOutOfOfficeQueryOptions(
      userId,
      range,
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
