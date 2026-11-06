import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import {
  enableRoutineCodeSteps,
  enableRoutineConditions,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';
import type { StepAuthor } from './context/routine-slots';
import type { RoutineSoFar } from './core/routine-steps';
import { composeStep, reviseStep } from './queries/compose-step';
import { useComposerContext } from './routine-ai-composer';

/**
 * AI that adds and changes the steps of `routine`, with the same workspace
 * names the routine drafter uses; Ask AI steps it writes run on the plan's
 * default model.
 */
export function createRoutineStepAuthor(
  routine: Accessor<RoutineSoFar>
): StepAuthor {
  const hasPaidAccess = useHasPaidAccess();
  const decisions = useFeatureFlag(enableRoutineConditions);
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const context = useComposerContext({
    defaultModel: () => defaultModelForPlan(hasPaidAccess()),
    decisionsEnabled: () => decisions().enabled,
  });
  return {
    code: () => codeSteps().enabled,
    add: (description, kind) =>
      composeStep({
        description,
        kind,
        routine: routine(),
        context: context(),
      }),
    revise: (step, instruction) =>
      reviseStep({
        step,
        instruction,
        routine: routine(),
        context: context(),
      }),
  };
}
