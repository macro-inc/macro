import type {
  CheckSummary,
  DraftJobProgress,
} from '@service-scheduled-action/generated/schemas';
import { describe, expect, it } from 'vitest';
import { draftActivity, draftMilestones } from './draft-progress';

const check = (ok: boolean, problems = 0, steps = 2): CheckSummary => ({
  checks: 1,
  ok,
  problems,
  name: 'Invoices to Finance tasks',
  trigger: { type: 'manual' } as unknown as CheckSummary['trigger'],
  steps: Array.from({ length: steps }, (_, index) => ({
    kind: 'agent' as const,
    title: `Step ${index + 1}`,
  })),
});

const rows = (progress: DraftJobProgress) =>
  draftMilestones(progress).map(({ state, label, detail }) =>
    detail ? `${state}: ${label} (${detail})` : `${state}: ${label}`
  );

describe('draft milestones', () => {
  it('starts by looking up what the request names', () => {
    expect(rows({ stage: 'started' })).toEqual([
      'now: Looking up what it names',
      'next: Write the steps',
      'next: Check that it runs',
    ]);
    expect(draftActivity({ stage: 'started' })).toBe('finding');
  });

  it('says what was found once it was looked up', () => {
    expect(rows({ stage: 'found', found: 2 })[0]).toBe(
      'done: Found the 2 things it names'
    );
    expect(rows({ stage: 'found', found: 1 })[0]).toBe(
      'done: Found what it names'
    );
  });

  it('moves to writing without a lookup, as drafts report today', () => {
    expect(rows({ stage: 'writing' })).toEqual([
      'done: Read your request',
      'now: Writing the steps',
      'next: Check that it runs',
    ]);
    expect(draftActivity({ stage: 'writing' })).toBe('writing');
  });

  it('counts the steps written once a check comes back', () => {
    expect(rows({ stage: 'checked', check: check(true, 0, 3) })).toEqual([
      'done: Read your request',
      'done: Wrote 3 steps',
      'now: Finishing up',
    ]);
    expect(rows({ stage: 'checked', check: check(true, 0, 1) })[1]).toBe(
      'done: Wrote 1 step'
    );
    expect(draftActivity({ stage: 'checked', check: check(true) })).toBe(
      'finishing'
    );
  });

  it('says it is fixing what a failed check found', () => {
    expect(rows({ stage: 'fixing', check: check(false, 1) })[2]).toBe(
      'now: Fixing a problem the check found'
    );
    expect(rows({ stage: 'fixing', check: check(false, 3) })[2]).toBe(
      'now: Fixing the problems the check found (3 problems to fix)'
    );
    // A failed check reported before its Fixing milestone reads the same.
    expect(draftActivity({ stage: 'checked', check: check(false, 1) })).toBe(
      'fixing'
    );
  });

  it('keeps the first milestone under way for a stage it does not know', () => {
    const progress = {
      stage: 'reviewing',
    } as unknown as DraftJobProgress;
    expect(rows(progress)[0]).toBe('now: Looking up what it names');
    expect(draftActivity(progress)).toBe('finding');
  });
});
