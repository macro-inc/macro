import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableRoutineCodeSteps,
  enableRoutineSuggestions,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import type {
  ActionConfiguration,
  RoutineSuggestion,
  RoutineSuggestions,
  SuggestedPickOneOfKnobs,
} from '@service-scheduled-action/generated/schemas';
import {
  DismissRoutineSuggestionDocument,
  type RoutineSuggestionFieldsFragment,
  RoutineSuggestionsDocument,
  type RoutineSuggestionsQuery,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createEffect, onCleanup } from 'solid-js';

/** How often to ask again while AI's suggestions are still arriving. */
const GENERATING_POLL_MS = 2_000;

/** A GraphQL enum value in the scheduler's spelling: `FOR_YOU` → `for_you`. */
function lower<Value extends string>(value: Value) {
  return value.toLowerCase() as Lowercase<Value>;
}

function mapSuggestion(
  suggestion: RoutineSuggestionFieldsFragment
): RoutineSuggestion {
  const shared = {
    id: suggestion.id,
    from: lower(suggestion.from),
    surfaces: suggestion.surfaces.map(lower),
    reason: suggestion.reason,
    keepProbability: suggestion.keepProbability,
    onByDefault: suggestion.onByDefault,
  };
  if (suggestion.pick.__typename === 'GraphqlCatalogRoutinePick') {
    return {
      ...shared,
      kind: 'catalog',
      key: suggestion.pick.key,
      // Both JSON scalars are the scheduler's own encoding, passed through.
      knobs: suggestion.pick.knobs as SuggestedPickOneOfKnobs,
    };
  }
  return {
    ...shared,
    kind: 'routine',
    routine: suggestion.pick.routine as ActionConfiguration,
  };
}

/**
 * The user's open suggestions in the scheduler's shape, or undefined while
 * suggestions are off for them. A dismissed suggestion stays in the cached
 * list with its new state, so it is left out here.
 */
export function mapRoutineSuggestions(
  data: RoutineSuggestionsQuery
): RoutineSuggestions | undefined {
  const answer = data.user.routineSuggestions;
  if (!answer) return undefined;
  return {
    status: lower(answer.status),
    suggestions: answer.suggestions
      .filter((suggestion) => suggestion.state === 'OPEN')
      .map(mapSuggestion),
  };
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
 * The live query behind every reader of the user's suggestions. Nothing
 * pushes a suggestion as a session hands it back, so while a generation runs
 * the list is read again every couple of seconds.
 */
export function createRoutineSuggestionsQuery(enabled: () => boolean) {
  const query = createLiveQuery(
    RoutineSuggestionsDocument,
    () => (enabled() ? {} : undefined),
    () => ({
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network' as const,
      select: mapRoutineSuggestions,
    })
  );

  createEffect(() => {
    if (query.data?.status !== 'generating') return;
    const timer = setInterval(() => {
      void query.refetch({ requestPolicy: 'network-only' });
    }, GENERATING_POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  return query;
}

/**
 * The user's suggestions on every surface, read once and filtered by each
 * sidebar, so dismissing one removes it everywhere at once.
 */
export function useRoutineSuggestions(): RoutineSuggestionsSource {
  const enabled = useRoutineSuggestionsEnabled();
  const query = createRoutineSuggestionsQuery(enabled);
  return {
    suggestions: () => query.data?.suggestions,
    generating: () => query.data?.status === 'generating',
    failed: () => query.error !== undefined && query.data === undefined,
    retry: () => {
      void query.refetch({ requestPolicy: 'network-only' });
    },
  };
}

/**
 * "Not interested": the suggestion leaves every list at once (its predicted
 * state) and isn't suggested again; rejects when the server refused.
 */
export async function dismissRoutineSuggestion(suggestionId: string) {
  const result = await getGraphqlSoupClient()
    .mutation(DismissRoutineSuggestionDocument, { suggestionId })
    .toPromise();
  if (result.error) throw result.error;
}

/**
 * A suggestion saved as a routine: the server leaves it out of later reads,
 * so the list is read again.
 */
export async function removeAcceptedSuggestion() {
  await getGraphqlSoupClient()
    .query(RoutineSuggestionsDocument, {}, { requestPolicy: 'network-only' })
    .toPromise();
}
