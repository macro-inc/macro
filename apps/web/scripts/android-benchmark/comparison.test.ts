import { describe, expect, it } from 'vitest';
import { compareRuns, type Results } from './comparison';
import type { TargetChoice } from './targets';

const channel = (index: number, fingerprint: string): TargetChoice => ({
  key: 'channel',
  index,
  of: 2,
  fingerprint,
});

function run(
  samples: {
    scenario: string;
    readyMs: number;
    contentMs?: number;
    target?: TargetChoice;
  }[]
): Results {
  return {
    meta: {},
    samples: samples.map((sample) => ({
      variant: 'cold',
      cpuThrottle: 4,
      ...sample,
    })),
  };
}

describe('compareRuns', () => {
  it('compares medians of the same step', () => {
    const a = run([
      { scenario: 'view.mail', readyMs: 100 },
      { scenario: 'view.mail', readyMs: 120 },
    ]);
    const b = run([
      { scenario: 'view.mail', readyMs: 132 },
      { scenario: 'view.mail', readyMs: 132 },
    ]);
    const { steps, warnings } = compareRuns(a, b);
    expect(warnings).toEqual([]);
    expect(steps).toHaveLength(1);
    expect(steps[0].a.median).toBe(110);
    expect(steps[0].change).toBeCloseTo(0.2, 6);
    expect(steps[0].differentTargets).toBe(false);
  });

  it('accepts a channel step that opened the same target in both runs', () => {
    const a = run([{ scenario: 'channel.open', readyMs: 900, target: channel(1, 'beef0001') }]);
    const b = run([{ scenario: 'channel.open', readyMs: 950, target: channel(1, 'beef0001') }]);
    expect(compareRuns(a, b).warnings).toEqual([]);
  });

  it('warns when the runs opened different channels', () => {
    const a = run([{ scenario: 'channel.open', readyMs: 900, target: channel(0, 'aaaa0000') }]);
    const b = run([{ scenario: 'channel.open', readyMs: 950, target: channel(1, 'bbbb1111') }]);
    const { steps, warnings } = compareRuns(a, b);
    expect(steps[0].differentTargets).toBe(true);
    expect(warnings).toEqual([
      'channel.open cold at 4×: A opened candidate 0 (aaaa0000), B opened candidate 1 (bbbb1111); not comparable',
    ]);
  });

  it('warns when one run itself opened two targets', () => {
    const a = run([
      { scenario: 'channel.open', readyMs: 900, target: channel(0, 'aaaa0000') },
      { scenario: 'channel.open', readyMs: 950, target: channel(1, 'bbbb1111') },
    ]);
    const b = run([{ scenario: 'channel.open', readyMs: 950, target: channel(0, 'aaaa0000') }]);
    expect(compareRuns(a, b).steps[0].differentTargets).toBe(true);
  });

  it('warns about results that did not record their target', () => {
    const a = run([{ scenario: 'channel.open', readyMs: 900 }]);
    const b = run([{ scenario: 'channel.open', readyMs: 950, target: channel(0, 'aaaa0000') }]);
    expect(compareRuns(a, b).warnings[0]).toMatch(/unrecorded target/);
  });

  it('checks the back step of a channel against its target too', () => {
    const a = run([{ scenario: 'channel.back', readyMs: 300, target: channel(0, 'aaaa0000') }]);
    const b = run([{ scenario: 'channel.back', readyMs: 300, target: channel(1, 'bbbb1111') }]);
    expect(compareRuns(a, b).steps[0].differentTargets).toBe(true);
  });

  it('warns when only one run waited for content to paint', () => {
    const a = run([{ scenario: 'view.notifications', readyMs: 120 }]);
    const b = run([{ scenario: 'view.notifications', readyMs: 600, contentMs: 600 }]);
    const { steps, warnings } = compareRuns(a, b);
    expect(steps[0].differentReadiness).toBe(true);
    expect(warnings).toEqual([
      'view.notifications cold at 4×: B waited for content to paint, the other ended at the span; not comparable',
    ]);
  });

  it('lists steps only one run measured', () => {
    const a = run([{ scenario: 'view.mail', readyMs: 100 }]);
    const b = run([{ scenario: 'view.files', readyMs: 100 }]);
    expect(compareRuns(a, b).warnings).toEqual([
      'view.mail cold at 4×: only in A',
      'view.files cold at 4×: only in B',
    ]);
  });
});
