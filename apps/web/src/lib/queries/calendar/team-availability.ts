import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys } from './keys';

type AvailabilityRange = { start: Date; end: Date };

function teamAvailabilityOptions(
  userId: string | undefined,
  range: AvailabilityRange | undefined,
  members: readonly string[]
) {
  const ids = [...new Set(members)].sort().slice(0, 100);
  return {
    queryKey: calendarKeys.teamAvailability(
      userId ?? '',
      range?.start.toISOString(),
      range?.end.toISOString(),
      ids
    ).queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (!userId || !range)
        throw new Error(
          'Guest availability requires an account and date range'
        );
      return throwOnErr(() =>
        storageServiceClient.getTeamAvailability(
          {
            start: range.start.toISOString(),
            end: range.end.toISOString(),
            userIds: ids,
          },
          signal
        )
      );
    },
    enabled: Boolean(userId && range && ids.length),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  };
}

/** Only explicitly requested people, at most 100, over the draft's bounded range. */
export function useTeamAvailabilityQuery(
  range: Accessor<AvailabilityRange | undefined>,
  members: Accessor<readonly string[]>
) {
  const userId = useUserId();
  return useQuery(() => teamAvailabilityOptions(userId(), range(), members()));
}
