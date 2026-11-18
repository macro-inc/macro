import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { type Accessor, onCleanup } from 'solid-js';
import type { StepAuthor } from './context/routine-slots';
import type { RoutineSoFar } from './core/routine-steps';
import { composeStep, reviseStep } from './queries/compose-step';
import { useComposerContext } from './routine-ai-composer';

/**
 * AI that adds and changes the steps of `routine`, with the same context the
 * routine drafter uses; Ask AI steps it writes run on the plan's default model.
 */
export function createRoutineStepAuthor(
  routine: Accessor<RoutineSoFar>
): StepAuthor {
  const hasPaidAccess = useHasPaidAccess();
  const context = useComposerContext({
    defaultModel: () => defaultModelForPlan(hasPaidAccess()),
    decisionsEnabled: () => true,
  });
  // A step still drafting when the editor closes isn't sent again.
  const left = new AbortController();
  onCleanup(() => left.abort());
  return {
    code: () => true,
    add: (description, kind) =>
      composeStep({
        description,
        kind,
        routine: routine(),
        context: context(),
        left: left.signal,
      }),
    revise: (step, instruction) =>
      reviseStep({
        step,
        instruction,
        routine: routine(),
        context: context(),
        left: left.signal,
      }),
  };
}
