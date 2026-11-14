import type { DraftJobProgress } from '@service-scheduled-action/generated/schemas';
import { match } from 'ts-pattern';

/** Where a milestone is: passed, under way, or still to come. */
type MilestoneState = 'done' | 'now' | 'next';

/** The three things drafting does, in order. */
type MilestoneStep = 'find' | 'write' | 'check';

export type DraftMilestone = {
  step: MilestoneStep;
  state: MilestoneState;
  /** What it did, does, or will do. */
  label: string;
  /** More about the step under way, under its label. */
  detail?: string;
};

/** What the check milestone is doing: checking, fixing what failed, or done. */
type CheckActivity = 'checking' | 'fixing' | 'finishing';

/** What a draft is doing now, for a status in a word or two. */
export type DraftActivity = 'finding' | 'writing' | CheckActivity;

const ORDER: MilestoneStep[] = ['find', 'write', 'check'];

/** The milestone under way at each stage. */
function current(progress: DraftJobProgress): MilestoneStep {
  return (
    match(progress.stage)
      .with('started', () => 'find' as const)
      .with('found', 'writing', () => 'write' as const)
      .with('checked', 'fixing', () => 'check' as const)
      // A stage a newer server reports: the first milestone stays under way.
      .exhaustive(() => 'find' as const)
  );
}

function findLabel(state: MilestoneState, found: number | null | undefined) {
  if (state === 'next') return 'Look up what it names';
  if (state === 'now') return 'Looking up what it names';
  if (!found) return 'Read your request';
  return found === 1
    ? 'Found what it names'
    : `Found the ${found} things it names`;
}

function writeLabel(state: MilestoneState, steps: number | undefined) {
  if (state === 'next') return 'Write the steps';
  if (state === 'now') return 'Writing the steps';
  if (!steps) return 'Wrote the steps';
  return steps === 1 ? 'Wrote 1 step' : `Wrote ${steps} steps`;
}

/** What the last milestone is doing once the drafter has reached it. */
function checking(progress: DraftJobProgress): CheckActivity {
  const check = progress.check;
  if (progress.stage === 'fixing' || (check && !check.ok)) return 'fixing';
  // A check that passed: the draft is done but for saving it.
  if (check?.ok) return 'finishing';
  return 'checking';
}

function checkMilestone(
  state: MilestoneState,
  progress: DraftJobProgress
): Pick<DraftMilestone, 'label' | 'detail'> {
  if (state === 'next') return { label: 'Check that it runs' };
  const problems = progress.check?.problems ?? 0;
  return match(checking(progress))
    .with('fixing', () => ({
      label:
        problems > 1
          ? 'Fixing the problems the check found'
          : 'Fixing a problem the check found',
      detail: problems > 1 ? `${problems} problems to fix` : undefined,
    }))
    .with('finishing', () => ({ label: 'Finishing up' }))
    .with('checking', () => ({ label: 'Checking that it runs' }))
    .exhaustive();
}

/**
 * The milestones of a draft still drafting. Each moves on when the drafter
 * reports it, never on a timer, so a draft that takes 10 seconds and one
 * that takes a minute read the same.
 */
export function draftMilestones(progress: DraftJobProgress): DraftMilestone[] {
  const at = ORDER.indexOf(current(progress));
  const stateOf = (step: MilestoneStep): MilestoneState => {
    const index = ORDER.indexOf(step);
    if (index < at) return 'done';
    return index === at ? 'now' : 'next';
  };
  const find = stateOf('find');
  const write = stateOf('write');
  const check = stateOf('check');
  return [
    { step: 'find', state: find, label: findLabel(find, progress.found) },
    {
      step: 'write',
      state: write,
      label: writeLabel(write, progress.check?.steps.length),
    },
    { step: 'check', state: check, ...checkMilestone(check, progress) },
  ];
}

/** What a draft still drafting is doing now. */
export function draftActivity(progress: DraftJobProgress): DraftActivity {
  return match(current(progress))
    .with('find', () => 'finding' as const)
    .with('write', () => 'writing' as const)
    .with('check', () => checking(progress))
    .exhaustive();
}
