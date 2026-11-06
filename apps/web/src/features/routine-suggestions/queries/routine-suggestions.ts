import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableRoutineCodeSteps,
  enableRoutineSuggestions,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type {
  RoutineSuggestion,
  RoutineSuggestions,
} from '@service-scheduled-action/generated/schemas';
import {
  type Query,
  queryOptions,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { routineSuggestionKeys } from './keys';

/** How often to ask again while the scheduler is still generating. */
const GENERATING_POLL_MS = 3_000;

function pollWhileGenerating(query: Query<RoutineSuggestions>) {
  return query.state.data?.status === 'generating' ? GENERATING_POLL_MS : false;
}

export function routineSuggestionsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: routineSuggestionKeys.all.queryKey,
    queryFn: () => throwOnErr(() => scheduledActionClient.routineSuggestions()),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: pollWhileGenerating,
    // FE-49: polls under open lists; unchanged rows keep their objects.
    reconcile: 'id',
    // 404 means suggestions are off for this user; asking again won't help.
    retry: false,
  });
}

/** Both flags suggestions ship behind, and a signed-in user. */
export function useRoutineSuggestionsEnabled(): () => boolean {
  const userId = useUserId();
  const suggestions = useFeatureFlag(enableRoutineSuggestions);
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  return () =>
    userId() !== undefined && suggestions().enabled && codeSteps().enabled;
}

export type RoutineSuggestionsSource = {
  /** Undefined until loaded; earlier ones stay while a generation runs. */
  suggestions(): RoutineSuggestion[] | undefined;
  /** A generation is running (the first, or a refresh). */
  generating(): boolean;
  /** Nothing to show because loading or generating failed. */
  failed(): boolean;
  refresh(): Promise<unknown>;
};

/** The user's suggestions, generated and stored by the scheduler. */
export function useRoutineSuggestions(): RoutineSuggestionsSource {
  const enabled = useRoutineSuggestionsEnabled();
  const query = useQuery(() => routineSuggestionsQueryOptions(enabled()));
  // FE-48: read data only once settled, and keep it through refetch errors.
  const current = () => (query.isPending ? undefined : query.data);
  return {
    suggestions: () => {
      const set = current();
      if (!set) return undefined;
      // Nothing generated yet reads as loading, not as "none".
      if (set.generatedAt == null && set.suggestions.length === 0) {
        return undefined;
      }
      return set.suggestions;
    },
    generating: () => current()?.status === 'generating',
    failed: () => {
      const set = current();
      if (set?.suggestions.length) return false;
      if (!set) return query.isError;
      return set.status === 'failed';
    },
    refresh: () => refreshRoutineSuggestions(),
  };
}

/** Start a generation now; polling picks up its result. */
export async function refreshRoutineSuggestions(): Promise<RoutineSuggestions> {
  const set = await throwOnErr(() =>
    scheduledActionClient.refreshRoutineSuggestions()
  );
  queryClient.setQueryData(routineSuggestionKeys.all.queryKey, set);
  return set;
}

function withoutSuggestion(id: string) {
  return (set: RoutineSuggestions | undefined) =>
    set && {
      ...set,
      suggestions: set.suggestions.filter((suggestion) => suggestion.id !== id),
    };
}

/** "Not interested": the suggestion leaves at once and isn't suggested again. */
export function useDismissRoutineSuggestionMutation() {
  return useMutation(() => ({
    mutationFn: (suggestionId: string) =>
      throwOnErr(() =>
        scheduledActionClient.dismissRoutineSuggestion({ suggestionId })
      ),
    onMutate: async (suggestionId: string) => {
      const key = routineSuggestionKeys.all.queryKey;
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RoutineSuggestions>(key);
      queryClient.setQueryData(key, withoutSuggestion(suggestionId));
      return { previous };
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(
        routineSuggestionKeys.all.queryKey,
        context?.previous
      );
    },
  }));
}

/** A suggestion saved as a routine leaves the list without a refetch. */
export function removeAcceptedSuggestion(suggestionId: string) {
  queryClient.setQueryData(
    routineSuggestionKeys.all.queryKey,
    withoutSuggestion(suggestionId)
  );
}
