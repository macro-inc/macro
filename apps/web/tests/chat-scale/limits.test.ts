import { describe, expect, it } from 'vitest';
import {
  type ChatScaleRun,
  limitFailures,
  STEP_NAMES,
  type StepMeasure,
  type StepName,
  summaryTable,
} from './limits';

const NO_REQUESTS = {
  requests: {},
  operations: {},
  subscriptions: {},
  sockets: {},
  defaulted: {},
};

/** One step at what a local run measured at 3,500 channels. */
function step(overrides: Partial<StepMeasure> = {}): StepMeasure {
  return {
    settleMs: 0,
    rowsMs: null,
    longTasks: { count: 10, totalMs: 1_000, maxMs: 170 },
    heapMb: 140,
    agentMemoryMb: null,
    domNodes: 1_622,
    metrics: {},
    requests: NO_REQUESTS,
    ...overrides,
  };
}

function run(
  channels: number,
  change: (name: StepName) => Partial<StepMeasure> = () => ({})
): ChatScaleRun {
  const steps = Object.fromEntries(
    STEP_NAMES.map((name) => [name, step(change(name))])
  ) as Record<StepName, StepMeasure>;
  return {
    channels,
    steps,
    backendErrors: [],
    pageErrors: [],
    requests: NO_REQUESTS,
  };
}

describe('limitFailures', () => {
  it('passes the sizes as they were measured', () => {
    expect(
      limitFailures([run(3_500), run(7_000, () => ({ heapMb: 180 }))])
    ).toEqual([]);
  });

  it('fails a run that measured nothing', () => {
    expect(limitFailures([])).toEqual(['no size was measured']);
  });

  it('fails a heap over its ceiling at that size', () => {
    expect(
      limitFailures([
        run(3_500, (name) => (name === 'scroll' ? { heapMb: 330 } : {})),
      ])
    ).toEqual(['3500 channels, scroll: heap (MB): 330, limit 320']);
  });

  it('holds loads and interactions to their own long task ceilings', () => {
    const failures = limitFailures([
      run(3_500, (name) =>
        name === 'coldOpen' || name === 'expand'
          ? { longTasks: { count: 1, totalMs: 900, maxMs: 900 } }
          : {}
      ),
    ]);
    expect(failures).toEqual([
      '3500 channels, expand: longest task (ms): 900, limit 700',
    ]);
  });

  it('fails a DOM that grows with the account', () => {
    const failures = limitFailures([
      run(3_500),
      run(7_000, (name) => (name === 'scroll' ? { domNodes: 2_200 } : {})),
    ]);
    expect(failures).toEqual([
      '3500 to 7000 channels, scroll: DOM growth: 1.36, limit 1.20',
    ]);
  });

  it('compares short long-task totals from the floor', () => {
    const failures = limitFailures([
      run(3_500, () => ({ longTasks: { count: 1, totalMs: 100, maxMs: 100 } })),
      run(7_000, (name) =>
        name === 'message'
          ? { longTasks: { count: 4, totalMs: 1_200, maxMs: 300 } }
          : { longTasks: { count: 2, totalMs: 400, maxMs: 200 } }
      ),
    ]);
    expect(failures).toEqual([
      '3500 to 7000 channels, message: long task growth: 2.40, limit 2.20',
    ]);
  });

  it('checks growth only between a size and its double', () => {
    expect(
      limitFailures([run(3_500), run(5_000, () => ({ domNodes: 3_000 }))])
    ).toEqual(['5000 channels has no heap ceiling']);
  });
});

describe('summaryTable', () => {
  it('lists every step of every size', () => {
    const table = summaryTable([run(3_500), run(7_000)]).split('\n');
    expect(table).toHaveLength(2 + 2 * STEP_NAMES.length);
    expect(table[2]).toBe(
      '| 3500 | seed |  | 140.0 | 1622 | 10 | 1000 | 170 | 0 |'
    );
  });
});
