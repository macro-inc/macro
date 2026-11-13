import { useUserId } from '@core/context/user';
import { getDefaultTimezone } from '@core/util/cron';
import { throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { Suggestion } from '../core/suggestion';
import { useSuggestionsFlag } from '../use-suggestions-flag';
import { toFeed } from './decode';
import { suggestionsKeys } from './keys';

function topOptions(userId: string, limit: number, enabled: boolean) {
  return queryOptions({
    ...suggestionsKeys.top(userId, limit),
    queryFn: async () =>
      toFeed(
        await throwOnErr(() =>
          scheduledActionClient.listSuggestions({
            timezone: getDefaultTimezone(),
            limit,
          })
        )
      ).suggestions,
    enabled,
  });
}

/**
 * The person's `limit` most important open suggestions, as the server picked
 * and ordered them; empty until read. Read when shown, never polled.
 */
export function useTopSuggestions(limit: number): Accessor<Suggestion[]> {
  const enabled = useSuggestionsFlag();
  const userId = useUserId();
  const top = useQuery(() =>
    topOptions(userId() ?? '', limit, enabled() && userId() !== undefined)
  );

  return () => top.data ?? [];
}
