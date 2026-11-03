import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth/license';
import {
  databaseModelForPlan,
  defaultModelForPlan,
} from '@core/component/AI/constant';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';
import type { StepAuthor } from './context/routine-slots';
import type { RoutineSoFar } from './core/routine-steps';
import { composeStep, reviseStep } from './queries/compose-step';
import { useComposerContext } from './routine-ai-composer';

/**
 * AI that adds and changes the steps of `routine`, with the same workspace
 * names and model the routine drafter uses.
 */
export function createRoutineStepAuthor(
  routine: Accessor<RoutineSoFar>
): StepAuthor {
  const hasPaidAccess = useHasPaidAccess();
  const decisions = useFeatureFlag(enableRoutineConditions);
  const context = useComposerContext({
    defaultModel: () => defaultModelForPlan(hasPaidAccess()),
    decisionsEnabled: () => decisions().enabled,
  });
  const model = () => databaseModelForPlan(hasPaidAccess());
  return {
    add: (description, kind) =>
      composeStep({
        description,
        kind,
        routine: routine(),
        context: context(),
        model: model(),
      }),
    revise: (step, instruction) =>
      reviseStep({
        step,
        instruction,
        routine: routine(),
        context: context(),
        model: model(),
      }),
  };
}
