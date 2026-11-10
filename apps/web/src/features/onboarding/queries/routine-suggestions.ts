import {
  createRoutineSuggestionsQuery,
  mapRoutineSuggestions,
} from '@app/features/routine-suggestions/queries/routine-suggestions';
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
} from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { useUserId } from '@core/context/user';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { useEnsureTagSetMutation } from '@queries/properties/tags';
import { getCreateScheduledActionUrl } from '@service-scheduled-action/generated/client';
import type {
  ActionConfiguration,
  RoutineSuggestion,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import {
  RoutineSuggestionsDocument,
  StartSuggestionGenerationDocument,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { RoutinesStepSource } from '../context/onboarding-context';
import {
  type CatalogSuggestion,
  catalogSuggestionDraft,
  type SuggestionEdits,
  type SuggestionRow,
  suggestionByline,
} from '../core/routine-suggestions';

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
 * Starts the person's onboarding generation (their ideas and routine
 * suggestions, as each is on for them); later calls change nothing on the
 * server. The suggestions read right after reach the step's list through the
 * cache; undefined when suggestions are off for them.
 */
export async function generateRoutineSuggestions(timezone: string) {
  const client = getGraphqlSoupClient();
  const started = await client
    .mutation(StartSuggestionGenerationDocument, { timezone })
    .toPromise();
  if (started.error) throw started.error;
  const answer = await client
    .query(RoutineSuggestionsDocument, {}, { requestPolicy: 'network-only' })
    .toPromise();
  if (answer.error) throw answer.error;
  return answer.data && mapRoutineSuggestions(answer.data);
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
  const query = createRoutineSuggestionsQuery(enabled);
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
    answer: () => query.data,
    failed: () => query.error !== undefined && query.data === undefined,
    refresh: () => query.refetch({ requestPolicy: 'network-only' }),
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
