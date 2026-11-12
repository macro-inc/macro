import { useUserId } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { getDefaultTimezone } from '@core/util/cron';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import type { SuggestionsSource } from '../context/suggestions-source';
import { type Suggestion, suggestionStatus } from '../core/suggestion';
import { useSuggestionsFlag } from '../use-suggestions-flag';
import { toSuggestion, toSuggestions } from './decode';
import { suggestionsKeys } from './keys';

/** How often to read again while a run is under way. */
const RUNNING_POLL_MS = 5_000;

function feedOptions(userId: string, enabled: boolean) {
  return queryOptions({
    ...suggestionsKeys.feed(userId),
    queryFn: async () =>
      toSuggestions(
        await throwOnErr(() =>
          scheduledActionClient.listSuggestions({
            timezone: getDefaultTimezone(),
          })
        )
      ),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some(
        (suggestion) => suggestionStatus(suggestion) === 'running'
      )
        ? RUNNING_POLL_MS
        : false,
  });
}

/**
 * The person's suggestions from the scheduler service. Nothing is read while suggestions
 * are off. The feed is read again after each write, since the server decides
 * where an suggestion goes next, and every few seconds while a run is under way.
 */
export function useSuggestionsSource(): SuggestionsSource {
  const enabled = useSuggestionsFlag();
  const userId = useUserId();
  const feed = useQuery(() =>
    feedOptions(userId() ?? '', enabled() && userId() !== undefined)
  );
  const queryClient = useQueryClient();
  const key = () => feedOptions(userId() ?? '', false).queryKey;
  const refresh = async () => {
    await feed.refetch();
  };

  // FE-49: the feed is read again under open cards; an suggestion that didn't
  // change keeps its object, so its card isn't rebuilt.
  const suggestions = createMemo<Suggestion[] | undefined>((previous) =>
    feed.data?.map((suggestion) => {
      const before = previous?.find((other) => other.id === suggestion.id);
      return before && deepEqual(before, suggestion) ? before : suggestion;
    })
  );

  return {
    suggestions,
    failed: () => feed.isError && suggestions() === undefined,
    retry: () => fireAndForget(refresh(), 'suggestions'),
    refresh,
    async accept(suggestion) {
      const { changed } = await throwOnErr(() =>
        scheduledActionClient.acceptSuggestion({
          suggestionId: suggestion.id,
          body: { updatedAt: suggestion.updatedAt },
        })
      );
      // The refusal carries the suggestion as it is now: show that, without
      // another read.
      const now = changed && toSuggestion(changed);
      if (!now) {
        await refresh();
        return changed ? 'changed' : 'accepted';
      }

      queryClient.setQueryData(key(), (suggestions: Suggestion[] | undefined) =>
        suggestions?.map((other) => (other.id === now.id ? now : other))
      );
      return 'changed';
    },
    async dismiss(id, options) {
      await throwOnErr(() =>
        scheduledActionClient.dismissSuggestion({
          suggestionId: id,
          // Sent as the page goes away, it must outlive it.
          keepalive: options?.leaving,
        })
      );
      await refresh();
    },
  };
}
