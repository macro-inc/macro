import { createEmptyDraft } from '@app/features/routines/core/routine-draft';
import { templateChain } from '@app/features/routines/core/routine-templates';
import { describeTrigger } from '@app/features/routines/core/routine-triggers';
import { useRoutineCatalog } from '@app/features/routines/queries/catalog';
import { draftToCreateBody } from '@app/features/routines/queries/routine-draft';
import { parseRoutineTriggers } from '@app/features/routines/queries/routine-trigger-mapping';
import { invalidateSchedules } from '@app/features/routines/queries/schedules';
import { analytics } from '@app/lib/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import {
  enableRoutineCodeSteps,
  enableRoutineSuggestions,
  enableSuggestions,
} from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { useUserId } from '@core/context/user';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { useEnsureTagSetMutation } from '@queries/properties/tags';
import {
  getCreateScheduledActionUrl,
  getListRoutineSuggestionsUrl,
  getStartSuggestionGenerationUrl,
} from '@service-scheduled-action/generated/client';
import type {
  ActionConfiguration,
  GenerationStarted,
  RoutineSuggestion,
  RoutineSuggestions,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { type Query, queryOptions, useQuery } from '@tanstack/solid-query';
import type { RoutinesStepSource } from '../context/onboarding-context';
import {
  type CatalogSuggestion,
  catalogSuggestionDraft,
  SUGGESTION_POLL_MS,
  type SuggestionEdits,
  type SuggestionRow,
  suggestionByline,
} from '../core/routine-suggestions';
import { onboardingRoutineKeys } from './keys';

const SCHEDULED_ACTION_HOST: string = SERVER_HOSTS['scheduled-action'];

type DraftedSuggestion = Extract<RoutineSuggestion, { kind: 'routine' }>;

/** Routine suggestions are on for this person: the flow ends with them. */
export function useRoutineSuggestionsEnabled(): () => boolean {
  const userId = useUserId();
  const suggestions = useFeatureFlag(enableRoutineSuggestions);
  // Suggestions are built on code-step routines and ship with them.
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  return () =>
    userId() !== undefined && suggestions().enabled && codeSteps().enabled;
}

/**
 * Suggestions of either kind are on for this person, so connecting an inbox
 * starts their onboarding generation, whether or not the flow has a routines
 * step.
 */
export function useSuggestionGenerationEnabled(): () => boolean {
  const routines = useRoutineSuggestionsEnabled();
  const userId = useUserId();
  const suggestions = useFeatureFlag(enableSuggestions);

  return () => routines() || (userId() !== undefined && suggestions().enabled);
}

/**
 * Starts the person's onboarding generation (their suggestions and routine
 * suggestions, as each is on for them); later calls change nothing on the
 * server.
 */
export async function startSuggestionGeneration(timezone: string) {
  await throwOnErr(() =>
    fetchWithToken<GenerationStarted>(
      `${SCHEDULED_ACTION_HOST}${getStartSuggestionGenerationUrl({ timezone })}`,
      { method: 'POST' }
    )
  );
}

/** The routine suggestions as they stand, to seed the routines step's list. */
export async function seedRoutineSuggestions() {
  const answer = await fetchSuggestions();
  queryClient.setQueryData(onboardingRoutineKeys.suggestions.queryKey, answer);
  return answer;
}

async function fetchSuggestions() {
  return await throwOnErr(() =>
    fetchWithToken<RoutineSuggestions>(
      `${SCHEDULED_ACTION_HOST}${getListRoutineSuggestionsUrl()}`,
      { method: 'GET' }
    )
  );
}

/** Ask again every couple of seconds while AI is still suggesting. */
function pollWhileGenerating(query: Query<RoutineSuggestions>) {
  return query.state.data?.status === 'generating' ? SUGGESTION_POLL_MS : false;
}

export function routineSuggestionsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: onboardingRoutineKeys.suggestions.queryKey,
    queryFn: fetchSuggestions,
    enabled,
    refetchInterval: pollWhileGenerating,
    // Each id stays one row while the list grows.
    reconcile: 'id',
  });
}

async function createFromSuggestion(
  body: ActionConfiguration,
  suggestionId: string
) {
  const created = await throwOnErr(() =>
    fetchWithToken<ScheduledAction>(
      `${SCHEDULED_ACTION_HOST}${getCreateScheduledActionUrl({ suggestion_id: suggestionId })}`,
      { method: 'POST', body: JSON.stringify(body) }
    )
  );
  analytics.track('routine_created', {
    routineId: created.id ?? undefined,
    source: 'suggestion',
    suggestionId,
    triggerType: created.trigger.type,
  });
  await invalidateSchedules();
  if (!created.id) throw new Error('Created routine has no id');
  return created.id;
}

function draftedRow(suggestion: DraftedSuggestion): SuggestionRow {
  const [trigger] = parseRoutineTriggers(suggestion.routine.trigger) ?? [];
  return {
    id: suggestion.id,
    surface: suggestion.surfaces[0] ?? 'agents',
    title: suggestion.routine.name,
    does: suggestion.routine.description ?? '',
    when: trigger ? describeTrigger(trigger) : undefined,
    byline: suggestionByline(suggestion),
  };
}

/** The scheduler's suggestions and catalog behind the last step. */
export function createAppRoutinesStep(): RoutinesStepSource {
  const enabled = useRoutineSuggestionsEnabled();
  const query = useQuery(() => routineSuggestionsQueryOptions(enabled()));
  const catalog = useRoutineCatalog();
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const hasPaidAccess = useHasPaidAccess();
  const ensureTagSet = useEnsureTagSetMutation();
  const entryFor = (key: string) =>
    catalog().find((routine) => routine.key === key);

  const catalogDraft = (suggestion: CatalogSuggestion) => {
    const entry = entryFor(suggestion.key);
    if (!entry) return undefined;
    const model = defaultModelForPlan(hasPaidAccess());
    return {
      entry,
      draft: catalogSuggestionDraft(
        suggestion,
        entry,
        { ...createEmptyDraft(model), triggers: [], steps: [], enabled: true },
        {
          target: { kind: 'model', model },
          codeSteps: codeSteps().enabled,
        }
      ),
    };
  };

  return {
    // FE-48: read data only once settled, and keep it through refetch errors.
    answer: () => (query.isPending ? undefined : query.data),
    failed: () => query.isError && query.data === undefined,
    refresh: () => query.refetch(),
    row(suggestion) {
      if (suggestion.kind === 'routine') return draftedRow(suggestion);
      const built = catalogDraft(suggestion);
      if (!built) return undefined;
      return {
        id: suggestion.id,
        surface: suggestion.surfaces[0] ?? built.entry.surfaces[0] ?? 'agents',
        title: built.entry.title,
        does: built.draft.description || built.entry.description,
        when: templateChain(built.entry).trigger || undefined,
        byline: suggestionByline(suggestion),
      };
    },
    async create(suggestion, edits: SuggestionEdits) {
      const runVisibility = edits.notify ? 'listed' : 'unlisted';
      if (suggestion.kind === 'routine') {
        return createFromSuggestion(
          {
            ...suggestion.routine,
            name: edits.name.trim() || suggestion.routine.name,
            run_visibility: runVisibility,
            enabled: true,
          },
          suggestion.id
        );
      }
      const built = catalogDraft(suggestion);
      if (!built) throw new Error('The catalog has no such routine');
      // A tagging routine adds its tags to the person's personal set.
      if (Object.values(built.entry.namedKnobs ?? {}).includes('tag')) {
        await ensureTagSet.mutateAsync({ scope: 'user' });
      }
      return createFromSuggestion(
        draftToCreateBody({
          ...built.draft,
          name: edits.name.trim() || built.draft.name,
          runVisibility,
          enabled: true,
        }),
        suggestion.id
      );
    },
  };
}
