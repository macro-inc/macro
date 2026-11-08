import type { RoutineTask } from '@service-scheduled-action/generated/schemas';
import {
  type CodeStepDraft,
  codeSteps as codeStepsOf,
  programSteps,
} from './routine-steps';

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

/** A paused routine whose code needs its owner after an SDK change. */
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

function codeSteps(task: RoutineTask | null | undefined): CodeStepDraft[] {
  return codeStepsOf((task && programSteps(task)) ?? []);
}

/**
 * What the owner has to review: the newest upgrade, when it paused the
 * routine and nothing saved since checks against its SDK. `sdk` is the SDK
 * the routine's code was last checked against.
 */
export function pendingCodeReview(
  upgrades: readonly CodeUpgradeRecord[],
  sdk: string | undefined
): CodeReview | undefined {
  const [latest] = upgrades;
  if (latest?.outcome !== 'needs_update' || latest.toSdk === sdk) return;
  const proposed = codeSteps(latest.task);
  const before = codeSteps(latest.previousTask);
  // Steps line up in program order; an update never adds or removes one.
  const changes = proposed.flatMap((step, index) => {
    const previous = before[index];
    return previous && previous.source !== step.source
      ? [{ title: step.title, before: previous.source, after: step.source }]
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
