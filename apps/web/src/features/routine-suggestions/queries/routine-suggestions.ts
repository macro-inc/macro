import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableRoutineCodeSteps,
  enableRoutineSuggestions,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { getDefaultTimezone } from '@core/util/cron';
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

/** How often to ask again while AI's suggestions are still arriving. */
const GENERATING_POLL_MS = 2_000;

function pollWhileGenerating(query: Query<RoutineSuggestions>) {
  return query.state.data?.status === 'generating' ? GENERATING_POLL_MS : false;
}

function routineSuggestionsQueryOptions(enabled: boolean) {
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
  /** Undefined until loaded; AI's arrive one by one while generating. */
  suggestions(): RoutineSuggestion[] | undefined;
  /** AI's suggestions are still being generated. */
  generating(): boolean;
  /** Nothing to show because loading failed. */
  failed(): boolean;
  retry(): void;
};

/**
 * The user's suggestions on every surface, read once and filtered by each
 * sidebar, so dismissing one removes it everywhere at once.
 */
export function useRoutineSuggestions(): RoutineSuggestionsSource {
  const enabled = useRoutineSuggestionsEnabled();
  const query = useQuery(() => routineSuggestionsQueryOptions(enabled()));
  // FE-48: read data only once settled, and keep it through refetch errors.
  const current = () => (query.isPending ? undefined : query.data);
  return {
    suggestions: () => current()?.suggestions,
    generating: () => current()?.status === 'generating',
    failed: () => query.isError && current() === undefined,
    retry: () => {
      queryClient.refetchQueries({
        queryKey: routineSuggestionKeys.all.queryKey,
      });
    },
  };
}

/**
 * Start the person's one generation of suggestions (onboarding calls it once
 * their inbox is connected); later calls change nothing.
 */
export async function generateRoutineSuggestions(): Promise<RoutineSuggestions> {
  const set = await throwOnErr(() =>
    scheduledActionClient.generateRoutineSuggestions({
      timezone: getDefaultTimezone(),
    })
  );
  // A generating answer turns polling on.
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

/**
 * A suggestion saved as a routine leaves the list at once. A read already
 * in flight could still hold it, so it is cancelled first; the server
 * leaves saved suggestions out of later reads.
 */
export async function removeAcceptedSuggestion(suggestionId: string) {
  const key = routineSuggestionKeys.all.queryKey;
  await queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData(key, withoutSuggestion(suggestionId));
}
