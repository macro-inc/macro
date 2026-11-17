import { match } from 'ts-pattern';
import { newStepId, type StepDraft } from './routine-steps';

/** A copy of `step` with a new id. */
export function copyStep(step: StepDraft): StepDraft {
  return match(step)
    .returnType<StepDraft>()
    .with({ kind: 'agent' }, (step) => ({ ...step, id: newStepId() }))
    .with({ kind: 'code' }, (step) => ({
      ...step,
      id: newStepId(),
      // Later code reads outputs by name, which a copy can't follow.
      output: undefined,
    }))
    .exhaustive();
}
