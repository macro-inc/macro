import { deepEqual } from '@core/util/compareUtils';
import type { RoutineTask } from '@service-scheduled-action/generated/schemas';
import {
  type CodeStepDraft,
  codeSteps as codeStepsOf,
  programSteps,
} from './routine-steps';
import { subRoutinesFromWire } from './sub-routines';

/** One way a routine's code was brought to a new SDK, as the scheduler lists it. */
export type CodeUpgradeRecord = {
  toSdk: string;
  outcome: 'running' | 'checked' | 'rewritten' | 'needs_update';
  reason?: string | null;
  previousTask: RoutineTask;
  task?: RoutineTask | null;
};

/** A code step the proposed update changes: its code before and after. */
export type CodeChange = { title: string; before: string; after: string };

/** A routine whose code needs its owner after an SDK change. */
export type CodeReview = {
  reason: string;
  /** The SDK the update is for. */
  sdk: string;
  /** The update a model proposed, when there is one to approve. */
  proposal?: { task: RoutineTask; changes: CodeChange[] };
};

/** The SDK a stored task's code was last checked against. */
export function taskSdk(task: RoutineTask): string | undefined {
  return 'steps' in task ? (task.sdk ?? undefined) : undefined;
}

/**
 * Each code step of a task, its sub-routines' after its own, keyed by where
 * it is, and titled with the sub-routine it belongs to. Undefined when the
 * task holds steps the editor can't show.
 */
function codeSteps(
  task: RoutineTask
): Map<string, CodeStepDraft & { label: string }> | undefined {
  const own = programSteps(task);
  const definitions = subRoutinesFromWire(task);
  if (!own || !definitions) return;
  const steps = new Map<string, CodeStepDraft & { label: string }>();
  codeStepsOf(own).forEach((step, index) => {
    steps.set(`${index}`, { ...step, label: step.title });
  });
  for (const definition of definitions) {
    codeStepsOf(definition.steps).forEach((step, index) => {
      steps.set(`${definition.name}/${index}`, {
        ...step,
        label: `${step.title} (in ${definition.title})`,
      });
    });
  }
  return steps;
}

/**
 * What the owner has to review: the newest upgrade that left the code for
 * them, while the saved task still matches the one the upgrade examined.
 * A proposal holds every code
 * step the update changes, its sub-routines' included, and approving it
 * saves all of them.
 */
export function pendingCodeReview(
  upgrades: readonly CodeUpgradeRecord[],
  currentTask: RoutineTask
): CodeReview | undefined {
  const [latest] = upgrades;
  if (
    latest?.outcome !== 'needs_update' ||
    latest.toSdk === taskSdk(currentTask) ||
    !deepEqual(latest.previousTask, currentTask)
  )
    return;
  const proposed = latest.task ? codeSteps(latest.task) : undefined;
  const before = codeSteps(latest.previousTask);
  // Steps line up in program order; an update never adds or removes one.
  const changes = [...(proposed ?? [])].flatMap(([place, step]) => {
    const previous = before?.get(place);
    return previous && previous.source !== step.source
      ? [{ title: step.label, before: previous.source, after: step.source }]
      : [];
  });
  return {
    reason: latest.reason ?? 'This routine’s code needs an update.',
    sdk: latest.toSdk,
    proposal:
      latest.task && changes.length
        ? { task: latest.task, changes }
        : undefined,
  };
}
