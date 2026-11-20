import { describe, expect, it } from 'vitest';
import { activityRuns, programFailures, programSteps } from './code-execution';

describe('programFailures', () => {
  it('counts the failed operations and calls a program shows', () => {
    expect(
      programFailures({
        statuses: ['completed', 'failed', 'unknown', 'failed'],
        ended: true,
        cancelled: false,
      })
    ).toBe(2);
  });

  it('counts the one row of a program that ended without steps', () => {
    expect(
      programFailures({ statuses: [], ended: true, cancelled: false })
    ).toBe(1);
  });

  it('does not count a program that was stopped, or is still going', () => {
    expect(
      programFailures({ statuses: [], ended: true, cancelled: true })
    ).toBe(0);
    expect(
      programFailures({ statuses: [], ended: false, cancelled: false })
    ).toBe(0);
  });
});

describe('activityRuns', () => {
  it('folds a program looping over one operation into one run', () => {
    const activity = [
      { id: 0, label: 'Get Team', status: 'completed' as const },
      ...Array.from({ length: 127 }, (_, index) => ({
        id: index + 1,
        label: 'Get User Names With Email',
        status: 'completed' as const,
      })),
      { id: 128, label: 'Search workspace', status: 'completed' as const },
    ];

    expect(
      activityRuns(activity).map((run) => [run.item.label, run.count])
    ).toEqual([
      ['Get Team', 1],
      ['Get User Names With Email', 127],
      ['Search workspace', 1],
    ]);
  });

  it('keeps steps apart when their outcome or order differs', () => {
    expect(
      activityRuns([
        { id: 0, label: 'Get Thread', status: 'completed' },
        { id: 1, label: 'Get Thread', status: 'failed' },
        { id: 2, label: 'Search workspace', status: 'completed' },
        { id: 3, label: 'Get Thread', status: 'completed' },
      ]).map((run) => [run.item.id, run.count])
    ).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
  });
});

describe('programSteps', () => {
  it('counts a loop over one operation as one step', () => {
    expect(
      programSteps({
        activity: Array.from({ length: 127 }, (_, index) => ({
          id: index,
          label: 'Get User Names With Email',
          status: 'completed' as const,
        })),
        calls: 0,
        ended: true,
      })
    ).toBe(1);
  });

  it('counts the one row of a program that ended without steps', () => {
    expect(programSteps({ activity: [], calls: 0, ended: true })).toBe(1);
    expect(programSteps({ activity: [], calls: 0, ended: false })).toBe(0);
  });
});
