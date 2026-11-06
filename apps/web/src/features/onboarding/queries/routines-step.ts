import { starterSuggestionDraft } from '@app/features/routine-suggestions/core/suggestion-draft';
import {
  refreshRoutineSuggestions,
  useRoutineSuggestions,
} from '@app/features/routine-suggestions/queries/routine-suggestions';
import { newRoutineDraft } from '@app/features/routines/core/routine-templates';
import { useRoutineCatalog } from '@app/features/routines/queries/catalog';
import { draftToCreateBody } from '@app/features/routines/queries/routine-draft';
import { useCreateScheduleMutation } from '@app/features/routines/queries/schedules';
import {
  useEmailLabelNames,
  useRoutineTags,
} from '@app/features/routines/queries/step-sources';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import {
  enableRoutineCodeSteps,
  enableRoutineSuggestions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { useEnsureTagSetMutation } from '@queries/properties/tags';
import type { RoutinesStepSource } from '../context/onboarding-context';

/** Start picking routines for the last step, where suggestions are on. */
export function warmRoutineSuggestions() {
  if (
    !isFeatureEnabled(enableRoutineSuggestions) ||
    !isFeatureEnabled(enableRoutineCodeSteps)
  ) {
    return;
  }
  fireAndForget(refreshRoutineSuggestions(), 'onboarding.routines');
}

/** The scheduler's suggestions and catalog behind the last step. */
export function createAppRoutinesStep(): RoutinesStepSource {
  const source = useRoutineSuggestions();
  const catalog = useRoutineCatalog();
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const hasPaidAccess = useHasPaidAccess();
  const labels = useEmailLabelNames();
  const tags = useRoutineTags();
  const ensureTagSet = useEnsureTagSetMutation();
  const create = useCreateScheduleMutation();
  const defaultModel = () => defaultModelForPlan(hasPaidAccess());
  return {
    suggestions: source.suggestions,
    generating: source.generating,
    failed: source.failed,
    refresh: source.refresh,
    catalog,
    draft(suggestion, edits) {
      const entry = catalog().find((routine) => routine.key === suggestion.key);
      if (!entry) return undefined;
      const base = newRoutineDraft(undefined, {
        defaultModel: defaultModel(),
        codeSteps: codeSteps().enabled,
      });
      return starterSuggestionDraft(
        { ...suggestion, knobs: { ...suggestion.knobs, ...edits } },
        entry,
        base,
        {
          target: { kind: 'model', model: defaultModel() },
          codeSteps: codeSteps().enabled,
          workspace: {
            label: labels(),
            tag: tags()
              .filter((tag) => tag.scope === 'user')
              .map((tag) => tag.label),
            // A new account has no channels of its own yet.
            channel: [],
          },
        }
      ).draft;
    },
    async create(suggestion, draft) {
      const entry = catalog().find((routine) => routine.key === suggestion.key);
      // A tagging routine adds its tags to the person's personal set.
      if (Object.values(entry?.namedKnobs ?? {}).includes('tag')) {
        await ensureTagSet.mutateAsync({ scope: 'user' });
      }
      const created = await create.mutateAsync({
        body: draftToCreateBody(draft),
        suggestionId: draft.suggestionId,
      });
      if (!created.id) throw new Error('Created routine has no ID');
      return created.id;
    },
  };
}
