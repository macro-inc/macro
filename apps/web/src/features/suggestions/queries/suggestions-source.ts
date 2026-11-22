import { routineSuggestionKeys } from '@app/features/routine-suggestions/queries/keys';
import { useUserId } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { getDefaultTimezone } from '@core/util/cron';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryReadyGate } from '@queries/gate';
import { scheduledActionClient } from '@service-scheduled-action/client';
import {
  notifyManager,
  queryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { createEffect, createMemo } from 'solid-js';
import type { SuggestionsSource } from '../context/suggestions-source';
import type { Suggestion, SuggestionFeed } from '../core/suggestion';
import { useSuggestionsFlag } from '../use-suggestions-flag';
import { toFeed, toSuggestion } from './decode';
import { generationOptions } from './generation';
import { suggestionsKeys } from './keys';

/** How often to read the feed again while a run or a generation is under way. */
const WORKING_POLL_MS = 10_000;

export function feedOptions(
  userId: string,
  enabled: boolean,
  generating: boolean
) {
  return queryOptions({
    ...suggestionsKeys.feed(userId),
    queryFn: async () =>
      toFeed(
        await throwOnErr(() =>
          scheduledActionClient.listSuggestions({
            timezone: getDefaultTimezone(),
          })
        )
      ),
    enabled,
    // Nothing is polled unless something is being worked on: a card's run,
    // or a generation that may add or change cards.
    refetchInterval: (query) =>
      generating ||
      query.state.data?.suggestions.some(
        (suggestion) => suggestion.status === 'running'
      )
        ? WORKING_POLL_MS
        : false,
  });
}

/** `feed` with `suggestion` open, added at its end if the feed no longer lists it. */
function reopened(
  feed: SuggestionFeed,
  suggestion: Suggestion
): SuggestionFeed {
  const open = (held: Suggestion): Suggestion => ({ ...held, status: 'open' });
  const listed = feed.suggestions.some((other) => other.id === suggestion.id);

  return {
    ...feed,
    suggestions: listed
      ? feed.suggestions.map((other) =>
          other.id === suggestion.id ? open(other) : other
        )
      : [...feed.suggestions, open(suggestion)],
  };
}

/**
 * The person's suggestions from the scheduler service. Nothing is read while suggestions
 * are off. The feed is read again after each write, since the server decides
 * where a suggestion goes next, and every ten seconds while a run or a
 * generation is under way.
 */
export function useSuggestionsSource(): SuggestionsSource {
  const enabled = useSuggestionsFlag();
  const userId = useUserId();
  const generation = useQuery(() =>
    generationOptions(userId() ?? '', enabled() && userId() !== undefined)
  );
  // Guarded: an unguarded read of a pending query suspends the page.
  const generating = () =>
    queryReadyGate(generation) && generation.data.state === 'running';
  const feed = useQuery(() =>
    feedOptions(
      userId() ?? '',
      enabled() && userId() !== undefined,
      generating()
    )
  );
  const queryClient = useQueryClient();
  const key = () => feedOptions(userId() ?? '', false, false).queryKey;
  const refresh = async () => {
    // Home's rows read their own entry: every reader follows a change.
    await Promise.all([
      feed.refetch(),
      queryClient.invalidateQueries({ queryKey: suggestionsKeys.top._def }),
    ]);
  };
  // The sidebar's Ideas count is the routine suggestions feature's read, and
  // a dismissed routine suggestion takes its idea with it. A read already
  // out may predate the dismissal, so it is dropped, not joined.
  const refreshIdeas = async () => {
    const ideas = { queryKey: routineSuggestionKeys.all.queryKey };
    await queryClient.cancelQueries(ideas);
    await queryClient.invalidateQueries(ideas);
  };
  /** Replace one suggestion in the feed held for `asked`, without a read. */
  const patch = (
    asked: ReturnType<typeof key>,
    id: string,
    change: (suggestion: Suggestion) => Suggestion
  ) =>
    queryClient.setQueryData(asked, (held: SuggestionFeed | undefined) =>
      held
        ? {
            ...held,
            suggestions: held.suggestions.map((other) =>
              other.id === id ? change(other) : other
            ),
          }
        : held
    );

  // A generation that just ended may have written its last cards after the
  // feed was last read.
  createEffect((wasGenerating: boolean) => {
    const now = generating();
    if (wasGenerating && !now) fireAndForget(refresh(), 'suggestions');

    return now;
  }, false);

  // FE-49: the feed is read again under open cards; a suggestion that didn't
  // change keeps its object, so its card isn't rebuilt.
  const shown = createMemo<SuggestionFeed | undefined>((previous) => {
    if (!queryReadyGate(feed)) return undefined;
    const next = feed.data;

    return {
      counts: next.counts,
      suggestions: next.suggestions.map((suggestion) => {
        const before = previous?.suggestions.find(
          (other) => other.id === suggestion.id
        );
        return before && deepEqual(before, suggestion) ? before : suggestion;
      }),
    };
  });

  return {
    feed: shown,
    failed: () => feed.isError && shown() === undefined,
    retry: () => fireAndForget(refresh(), 'suggestions'),
    refresh,
    async accept(suggestion) {
      // The answer belongs to the feed it was asked from.
      const asked = key();
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

      patch(asked, now.id, () => now);
      return 'changed';
    },
    async dismiss(id) {
      await throwOnErr(() =>
        scheduledActionClient.dismissSuggestion({ suggestionId: id })
      );
      // The row waits only for its own feed.
      fireAndForget(refreshIdeas(), 'suggestions.ideas');
      await refresh();
    },
    async stop(id) {
      await throwOnErr(() =>
        scheduledActionClient.stopSuggestionRun({ suggestionId: id })
      );
      await refresh();
    },
    async restore(suggestion) {
      const asked = key();
      await throwOnErr(() =>
        scheduledActionClient.restoreSuggestion({
          suggestionId: suggestion.id,
        })
      );
      // A read already out may predate the restore: drop it (awaiting lets
      // one that has answered land first), so it can't put the old state
      // back over the restored one.
      await queryClient.cancelQueries({ queryKey: asked });
      // Restored is open: say so before the read, which keeps what it held
      // if it fails. A dismissed one has left the feed, so it goes back in.
      queryClient.setQueryData(asked, (held: SuggestionFeed | undefined) =>
        held ? reopened(held, suggestion) : held
      );
      // Readers hear of the patch on the next notify; resolving after it
      // means a caller that drops its own copy of the row never leaves a gap.
      await new Promise<void>((resolve) => notifyManager.schedule(resolve));
      // The row shows open now; the read that follows doesn't hold it.
      fireAndForget(refresh(), 'suggestions');
    },
    viewed: () =>
      fireAndForget(
        // Sent as the page goes away, it must outlive it.
        throwOnErr(() =>
          scheduledActionClient.recordSuggestionsViewed({ keepalive: true })
        ),
        'suggestions.viewed'
      ),
  };
}
