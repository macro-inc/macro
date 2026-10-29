import { getDefaultTimezone } from '@core/util/cron';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type RoutineSuggestionSet,
  routineSuggestionsClient,
} from '@service-cognition/routine-suggestions';
import { type Query, queryOptions, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { RoutineSuggestion } from '../core/suggestions';
import { routineSuggestionKeys } from './keys';
import { toRoutineSuggestions } from './suggestion-wire';

/** How often to ask again while the server is still generating. */
const GENERATING_POLL_MS = 3_000;

function pollWhileGenerating(query: Query<RoutineSuggestionSet>) {
  return query.state.data?.status === 'generating' ? GENERATING_POLL_MS : false;
}

function routineSuggestionsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: routineSuggestionKeys.set.queryKey,
    queryFn: () => throwOnErr(() => routineSuggestionsClient.get()),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: pollWhileGenerating,
    // FE-49: polls under the open suggestion list; an unchanged answer keeps
    // its objects, so rows don't remount and drop focus.
    reconcile: 'id',
  });
}

async function startRefresh() {
  const set = await throwOnErr(() => routineSuggestionsClient.refresh());
  // A generating answer turns polling back on.
  queryClient.setQueryData(routineSuggestionKeys.set.queryKey, set);
  return set;
}

export type RoutineSuggestionsSource = {
  /** Undefined until a result exists; earlier results stay while refreshing. */
  suggestions(): RoutineSuggestion[] | undefined;
  /** A generation is running (first time or a refresh). */
  generating(): boolean;
  /** Set when there is nothing to show because loading or generating failed. */
  error(): string | undefined;
  refresh(): Promise<unknown>;
};

/** The user's routine suggestions, generated and stored by the server. */
export function createRoutineSuggestions(options: {
  /** Whether the user has loaded, so the request carries their identity. */
  ready: Accessor<boolean>;
}): RoutineSuggestionsSource {
  const query = useQuery(() => routineSuggestionsQueryOptions(options.ready()));
  const [refreshing, setRefreshing] = createSignal(false);
  // FE-48: read data only once the query has settled, and keep it through
  // refetch errors.
  const set = () => (query.isPending ? undefined : query.data);
  const suggestions = createMemo(() => {
    const current = set();
    if (!current) return undefined;
    if (current.generatedAt == null && current.suggestions.length === 0) {
      return undefined;
    }
    return toRoutineSuggestions(current.suggestions, getDefaultTimezone());
  });
  return {
    suggestions,
    generating: () => refreshing() || set()?.status === 'generating',
    error: () => {
      if (suggestions()?.length) return undefined;
      if (query.isError && !set()) return query.error.message;
      return set()?.status === 'failed'
        ? 'Routine suggestions could not be generated.'
        : undefined;
    },
    refresh: async () => {
      setRefreshing(true);
      try {
        return await startRefresh();
      } finally {
        setRefreshing(false);
      }
    },
  };
}

/**
 * Starts generating the suggestions onboarding's last step shows, from the
 * inbox and tools connected so far, so they are ready by the time it opens.
 */
export async function warmRoutineSuggestions(): Promise<void> {
  await startRefresh();
}
