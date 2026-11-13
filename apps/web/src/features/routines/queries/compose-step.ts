import type {
  ActionTrigger,
  DraftedStep,
  RoutineSoFar as WireRoutine,
} from '@service-scheduled-action/generated/schemas';
import {
  type AddedStep,
  type CodeStepDraft,
  type RoutineSoFar,
  type StepDraft,
  type StepKind,
  stepsFromWire,
  stepsToWire,
} from '../core/routine-steps';
import { type ComposerContext, requestDraft } from './compose-routine';
import { serializeTriggers } from './routine-trigger-mapping';

/** The routine as the drafter reads it: its trigger as it would save, if it can. */
function routineSoFar(routine: RoutineSoFar): WireRoutine {
  let trigger: ActionTrigger | undefined;
  try {
    trigger = routine.triggers.length
      ? serializeTriggers(routine.triggers)
      : undefined;
  } catch {
    // A trigger still being filled in can't be saved yet; AI reads the steps.
    trigger = undefined;
  }
  return {
    ...(trigger ? { trigger: { ...trigger } } : {}),
    steps: stepsToWire(routine.steps),
  };
}

/** A drafted step for the editor, with the problems its code still has. */
function stepFromDraft(drafted: DraftedStep): StepDraft | undefined {
  const step = stepsFromWire([drafted.step])?.[0];
  if (!step || step.kind !== 'code' || !drafted.problems.length) return step;
  return { ...step, problems: drafted.problems };
}

const FAILED = 'Couldn’t write that step. Please try again.';

/**
 * Draft one step to add at the end of `routine` from a description. AI
 * makes it code when it does the same thing every run, and Ask AI when it
 * needs judgment each time; `kind` decides instead.
 */
export async function composeStep(opts: {
  description: string;
  routine: RoutineSoFar;
  context: ComposerContext;
  kind?: StepKind;
  /** Aborts once nobody waits for the step. */
  left?: AbortSignal;
}): Promise<AddedStep | string> {
  const drafted = await requestDraft(
    {
      type: 'add_step',
      description: opts.description,
      routine: routineSoFar(opts.routine),
      ...(opts.kind ? { kind: opts.kind } : {}),
    },
    opts.context,
    FAILED,
    opts.left
  );
  if (typeof drafted === 'string') return drafted;
  if (drafted.outcome !== 'step') return FAILED;
  const step = stepFromDraft(drafted);
  return step ? { step, reason: drafted.reason } : FAILED;
}

/**
 * Rewrite a code step as `instruction` says, checked with the routine around
 * it. It keeps its place, name and output; its knobs keep their values
 * unless the change is about them.
 */
export async function reviseStep(opts: {
  step: CodeStepDraft;
  instruction: string;
  routine: RoutineSoFar;
  context: ComposerContext;
  /** Aborts once nobody waits for the step. */
  left?: AbortSignal;
}): Promise<CodeStepDraft | string> {
  const failed = 'Couldn’t change that step. Please try again.';
  const index = opts.routine.steps.findIndex(
    (step) => step.id === opts.step.id
  );
  if (index < 0) return failed;
  const drafted = await requestDraft(
    {
      type: 'change_step',
      instruction: opts.instruction,
      routine: routineSoFar(opts.routine),
      index,
    },
    opts.context,
    failed,
    opts.left
  );
  if (typeof drafted === 'string') return drafted;
  if (drafted.outcome !== 'step') return failed;
  const step = stepFromDraft(drafted);
  // The editor knows it by its id.
  return step?.kind === 'code' ? { ...step, id: opts.step.id } : failed;
}
