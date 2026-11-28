/**
 * What the Chat scale tier measures per step, and the loose limits a run
 * fails on: ceilings at each size, and growth from 3,500 to 7,000 channels.
 * The tier runs on shared CI machines, so a ceiling sits two to four times
 * above what a local run measured and catches a regression of that order,
 * not a few percent.
 */
import type { BackendCounts } from './backend';

export const STEP_NAMES = [
  'seed',
  'coldOpen',
  'message',
  'scroll',
  'collapse',
  'expand',
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export type StepMeasure = {
  /** From the step's start to its last request. */
  settleMs: number;
  /** From navigation until the Conversations rail showed its first rows on
   * screen; loads only. */
  rowsMs: number | null;
  longTasks: { count: number; totalMs: number; maxMs: number };
  /** The page's JavaScript heap after a forced collection. */
  heapMb: number;
  /** `measureUserAgentSpecificMemory`, page and its workers, when offered. */
  agentMemoryMb: number | null;
  domNodes: number;
  /** Conversation rows the rail had mounted once the step settled. */
  rowsMounted: number;
  /** What the step read from the server (`fixture.ts`): rows asked for,
   * channel ids named by by-ID reads, and rows returned. */
  server: { rowsRequested: number; idsRequested: number; rowsReturned: number };
  /** Chromium's counters over the step (`Performance.getMetrics`). */
  metrics: Record<string, number>;
  requests: BackendCounts;
};

export type ChatScaleRun = {
  channels: number;
  steps: Record<StepName, StepMeasure>;
  backendErrors: string[];
  pageErrors: string[];
  requests: BackendCounts;
};

/** The steps that load the page; the rest are what a viewer does in it. */
export const LOADS: readonly StepName[] = ['seed', 'coldOpen'];

/**
 * Ceilings, the same at both sizes unless a size is named, about twice the
 * highest of four local runs (2026-11-28, on a shared 96-CPU machine at a
 * load average of 60 to 130, which lengthens long tasks). At 3,500 / 7,000
 * channels they measured heap after collection of 701 / 1,333 MB in the
 * seed, which writes the whole cache, and 241 / 388 MB at most in the steps
 * after it; 1,674 DOM nodes at most; rows on screen 1.5–3.4 s after
 * navigation; a load's longest task 1.07 s and its tasks 31 / 113 s in all;
 * an interaction's longest task 0.88 s and its tasks 4.9 / 17.9 s in all.
 */
export const CEILINGS = {
  heapMb: {
    seed: { 3500: 1_400, 7000: 2_700 } as Readonly<Record<number, number>>,
    afterSeed: { 3500: 550, 7000: 950 } as Readonly<Record<number, number>>,
  },
  domNodes: 4_000,
  rowsMs: 8_000,
  load: { longestTaskMs: 2_500, longTasksMs: 240_000 },
  interaction: { longestTaskMs: 2_000, longTasksMs: 40_000 },
} as const;

/**
 * Growth from N to 2N channels, per step. Chat mounts only the rows on
 * screen, so its DOM should not grow with the account (1.05 times, measured).
 * Its heap and long tasks do today, because the sidebar's work follows every
 * channel its sections and favorites name: in the runs above the heap grew
 * 1.6–1.9 times, a load's long tasks 3.3–6.2 times, and an interaction's up to
 * 5.5 times (one run's message step at 2N also took the app's token refresh, a
 * second round of polls and 2,838 server rows against 1,869). These limits
 * catch growth past that; lower them as that work is bounded by the screen.
 * Under `LONG_TASK_FLOOR_MS` at N, long tasks compare as that floor, since a
 * few long tasks' jitter is not growth.
 */
export const GROWTH = {
  heap: 2.2,
  domNodes: 1.2,
  longTasks: { load: 10, interaction: 8 },
} as const;

export const LONG_TASK_FLOOR_MS = 500;

/**
 * The least a measured step can read: Chat open over thousands of channels
 * holds tens of megabytes and hundreds of elements, and loading it runs long
 * tasks. A reading under one of these is a measurement that did not happen
 * (an observer that never ran, a page that never loaded), which would pass
 * every ceiling.
 */
export const FLOORS = {
  heapMb: 10,
  domNodes: 200,
  loadLongTasks: 1,
} as const;

type Check = { name: string; value: number; limit: number };

function floorFailures(run: ChatScaleRun): string[] {
  return STEP_NAMES.flatMap((name) => {
    const step = run.steps[name];
    const at = `${run.channels} channels, ${name}`;
    const load = LOADS.includes(name);
    const floors: Check[] = [
      { name: `${at}: heap (MB)`, value: step.heapMb, limit: FLOORS.heapMb },
      {
        name: `${at}: DOM nodes`,
        value: step.domNodes,
        limit: FLOORS.domNodes,
      },
      ...(load
        ? [
            {
              name: `${at}: long tasks`,
              value: step.longTasks.count,
              limit: FLOORS.loadLongTasks,
            },
          ]
        : []),
    ];
    return [
      ...(load && step.rowsMs === null
        ? [`${at}: rows on screen never measured`]
        : []),
      ...floors
        .filter((check) => check.value < check.limit)
        .map((check) => describe(check, 'at least')),
    ];
  });
}

function ceilingChecks(run: ChatScaleRun): Check[] {
  return STEP_NAMES.flatMap((name) => {
    const heapLimit = (
      name === 'seed' ? CEILINGS.heapMb.seed : CEILINGS.heapMb.afterSeed
    )[run.channels];
    const step = run.steps[name];
    const tasks = LOADS.includes(name) ? CEILINGS.load : CEILINGS.interaction;
    const at = `${run.channels} channels, ${name}`;
    const checks: Check[] = [
      {
        name: `${at}: DOM nodes`,
        value: step.domNodes,
        limit: CEILINGS.domNodes,
      },
      {
        name: `${at}: longest task (ms)`,
        value: step.longTasks.maxMs,
        limit: tasks.longestTaskMs,
      },
      {
        name: `${at}: long tasks in all (ms)`,
        value: step.longTasks.totalMs,
        limit: tasks.longTasksMs,
      },
    ];
    if (heapLimit !== undefined)
      checks.push({
        name: `${at}: heap (MB)`,
        value: step.heapMb,
        limit: heapLimit,
      });
    if (step.rowsMs !== null)
      checks.push({
        name: `${at}: rows on screen (ms)`,
        value: step.rowsMs,
        limit: CEILINGS.rowsMs,
      });
    return checks;
  });
}

function growthChecks(small: ChatScaleRun, large: ChatScaleRun): Check[] {
  const at = `${small.channels} to ${large.channels} channels`;
  return STEP_NAMES.flatMap((name) => {
    const n = small.steps[name];
    const twoN = large.steps[name];
    const ratio = (value: number, base: number) => value / Math.max(base, 1);
    return [
      {
        name: `${at}, ${name}: heap growth`,
        value: ratio(twoN.heapMb, n.heapMb),
        limit: GROWTH.heap,
      },
      {
        name: `${at}, ${name}: DOM growth`,
        value: ratio(twoN.domNodes, n.domNodes),
        limit: GROWTH.domNodes,
      },
      {
        name: `${at}, ${name}: long task growth`,
        value: ratio(
          twoN.longTasks.totalMs,
          Math.max(n.longTasks.totalMs, LONG_TASK_FLOOR_MS)
        ),
        limit: LOADS.includes(name)
          ? GROWTH.longTasks.load
          : GROWTH.longTasks.interaction,
      },
    ];
  });
}

function describe(check: Check, bound = 'limit'): string {
  const shown = (value: number) =>
    Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${check.name}: ${shown(check.value)}, ${bound} ${shown(check.limit)}`;
}

/** The measurements as a Markdown table, for the run's summary. */
export function summaryTable(runs: readonly ChatScaleRun[]): string {
  const rows = runs.flatMap((run) =>
    STEP_NAMES.map((name) => {
      const step = run.steps[name];
      const requests = Object.values(step.requests.requests).reduce(
        (sum, count) => sum + count,
        0
      );
      return [
        run.channels,
        name,
        step.rowsMs === null ? '' : Math.round(step.rowsMs),
        step.heapMb.toFixed(1),
        step.domNodes,
        step.rowsMounted,
        `${step.server.rowsRequested} / ${step.server.rowsReturned}`,
        step.longTasks.count,
        step.longTasks.totalMs,
        step.longTasks.maxMs,
        requests,
      ].join(' | ');
    })
  );
  return [
    '| Channels | Step | Rows on screen (ms) | Heap (MB) | DOM nodes | Rows mounted | Server rows asked / returned | Long tasks | Long tasks (ms) | Longest (ms) | Requests |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row} |`),
  ].join('\n');
}

/** Every limit a run broke, or none: floors and ceilings per size, growth
 * between a size and its double. A run of one size (`-g 3500`) checks only
 * that size's floors and ceilings. */
export function limitFailures(runs: readonly ChatScaleRun[]): string[] {
  if (runs.length === 0) return ['no size was measured'];
  const bySize = [...runs].sort((a, b) => a.channels - b.channels);
  const unknown = bySize
    .filter(
      (run) =>
        CEILINGS.heapMb.seed[run.channels] === undefined ||
        CEILINGS.heapMb.afterSeed[run.channels] === undefined
    )
    .map((run) => `${run.channels} channels has no heap ceiling`);
  const pairs = bySize.flatMap((small) => {
    const large = bySize.find((run) => run.channels === small.channels * 2);
    return large ? [growthChecks(small, large)] : [];
  });
  const failed = [...bySize.map(ceilingChecks), ...pairs]
    .flat()
    .filter((check) => check.value > check.limit)
    .map((check) => describe(check));
  return [...unknown, ...bySize.flatMap(floorFailures), ...failed];
}
