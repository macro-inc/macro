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
      'now: Looking up what it names (Channels, people, labels and more, by the names you used)',
      'next: Write the steps',
      'next: Check that it runs',
    ]);
    expect(draftActivity({ stage: 'started' })).toBe('finding');
  });

  it('says what it found by name', () => {
    const found = (names: DraftJobProgress['names']) =>
      rows({ stage: 'found', found: names?.found.length, names })[0];
    expect(
      found({ found: [{ name: 'Finance', kind: 'label' }], left: [] })
    ).toBe('done: Found your Finance label');
    expect(
      found({
        found: [
          { name: 'engineering', kind: 'channel' },
          { name: 'Priya Shah', kind: 'person' },
        ],
        left: [],
      })
    ).toBe('done: Found #engineering and Priya Shah');
    expect(
      found({
        found: [
          { name: 'engineering', kind: 'channel' },
          { name: 'Q4 Launch', kind: 'initiative' },
          { name: 'Invoices', kind: 'database' },
          { name: 'Specs', kind: 'project' },
        ],
        left: [],
      })
    ).toBe(
      'done: Found #engineering, your Q4 Launch project and 2 more (Also your Invoices database, your Specs folder)'
    );
  });

  it('says which names the person picks, and why', () => {
    expect(
      rows({
        stage: 'writing',
        found: 1,
        names: {
          found: [{ name: 'Finance', kind: 'label' }],
          left: [{ name: 'marketing', kind: 'channel', matches: 0 }],
        },
      })[0]
    ).toBe(
      "done: Found your Finance label (No channel is called #marketing, so you'll pick one)"
    );
    expect(
      rows({
        stage: 'writing',
        found: 0,
        names: {
          found: [],
          left: [
            { name: 'Jordan', kind: 'person', matches: 2 },
            { name: 'Roadmap', matches: 0 },
          ],
        },
      })[0]
    ).toBe(
      "done: Looked up what it names (You'll pick 2: 2 people are called Jordan; no item is called Roadmap)"
    );
  });

  it('reads a kind it does not know as an item', () => {
    expect(
      rows({
        stage: 'found',
        found: 0,
        names: {
          found: [],
          left: [
            {
              name: 'Board',
              kind: 'whiteboard' as unknown as 'task',
              matches: 3,
            },
          ],
        },
      })[0]
    ).toBe("done: Looked up what it names (3 items are called Board, so you'll pick which)");
  });

  it('counts what was found from a server that reports only a count', () => {
    expect(rows({ stage: 'found', found: 2 })[0]).toBe(
      'done: Found the 2 things it names'
    );
    expect(rows({ stage: 'found', found: 1 })[0]).toBe(
      'done: Found what it names'
    );
  });

  it('moves to writing without a lookup, as session drafts report', () => {
    expect(rows({ stage: 'writing' })).toEqual([
      'done: Read your request',
      'now: Writing the steps (Its trigger and every step, in one pass)',
      'next: Check that it runs',
    ]);
    expect(draftActivity({ stage: 'writing' })).toBe('writing');
  });

  it('names the steps written once a check comes back', () => {
    expect(rows({ stage: 'checked', check: check(true, 0, 3) })).toEqual([
      'done: Read your request',
      'done: Wrote 3 steps (Step 1 · Step 2 · Step 3)',
      'now: Finishing up (Invoices to Finance tasks)',
    ]);
    expect(rows({ stage: 'checked', check: check(true, 0, 1) })[1]).toBe(
      'done: Wrote 1 step (Step 1)'
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
    expect(rows(progress)[0]).toBe(
      'now: Looking up what it names (Channels, people, labels and more, by the names you used)'
    );
    expect(draftActivity(progress)).toBe('finding');
  });
});
