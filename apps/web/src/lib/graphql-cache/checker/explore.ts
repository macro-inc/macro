/**
 * Systematic exploration: every schedule of a scenario with at most
 * `maxFaults` injected faults and at most `maxDelays` out-of-order deliveries
 * (delivering a later channel's message before the oldest one), within the
 * scenario's horizon. Runs are replayed from scratch from their choices.
 * A branch is skipped when the same coarse state (`World.signature`) was
 * already branched from with at least the same budget left; that is the one
 * approximation in "every schedule", and the report says how many it pruned.
 */
import { check, QUIET_MS } from './properties';
import { type Fault, type Scenario, World } from './world';

export type Bound = {
  maxFaults: number;
  maxDelays: number;
  maxRuns: number;
  /** False explores every schedule, merging no states. */
  prune?: boolean;
};

type Budget = { faults: number; delays: number };

type StepRecord = {
  choice: number;
  options: number;
  /** Index from which options are faults. */
  faultStart: number;
  /** Options past the first delivery that deliver out of order. */
  delays: number;
  signature: string;
};

export type RunResult = {
  choices: number[];
  records: StepRecord[];
  violations: FoundViolation[];
  steps: string[];
};

/** Faults of a violation's key, as a set to compare with another's. */
export type ViolationKey = {
  symptom: string;
  faults: string[];
  reordered: boolean;
};

export function violationKey({
  symptom,
  faults,
  reordered,
}: ViolationKey): string {
  const how = faults.length > 0 ? faults.join('+') : 'no fault';
  return `${symptom} [${how}${reordered ? ', reordered' : ''}]`;
}

/** Whether `narrow` shows the same symptom as `wide` with no more to cause it. */
export function explains(narrow: ViolationKey, wide: ViolationKey): boolean {
  return (
    narrow.symptom === wide.symptom &&
    (wide.reordered || !narrow.reordered) &&
    narrow.faults.every((fault) => wide.faults.includes(fault))
  );
}

export type FoundViolation = ViolationKey & { detail: string };

export type Finding = FoundViolation & {
  /** A shortest schedule that shows it, and the choices that replay it. */
  steps: string[];
  choices: number[];
  runs: number;
};

export type ExplorationReport = {
  scenario: string;
  bound: Bound;
  runs: number;
  pruned: number;
  truncated: boolean;
  /** Each distinct violation, less those a simpler cause also shows. */
  findings: Finding[];
};

const MAX_STEPS = 600;

/**
 * Opens the scenario's pages and gives each its workload, a draft and a
 * read, at once, as the app does before its cache is ready. Faults can land
 * from the first step on, so startup is explored too.
 */
async function boot(world: World): Promise<void> {
  for (const buildTime of world.scenario.pages) await world.openPage(buildTime);
  for (const page of world.pages) {
    world.sim.runIn(page.context, () => {
      page.draft();
      page.read();
    });
  }
  await world.sim.settle();
}

/** Runs the default schedule until nothing is due before `ms` from now. */
async function quiesce(world: World, ms: number): Promise<void> {
  const until = world.sim.now + ms;
  for (let step = 0; step < 20_000; step += 1) {
    const [next] = world.options();
    if (!next) return;
    if (
      next.label.startsWith('timer') &&
      (world.sim.nextTimer()?.at ?? Infinity) > until
    )
      return;
    await next.run();
  }
}

/**
 * Faults stop: every live page comes online and is shown, except a frozen
 * one. A background page can stay frozen for as long as the browser likes,
 * so it stays hidden and frozen, and the other pages must not need it.
 */
async function quiet(world: World): Promise<void> {
  world.quiet = true;
  for (const page of world.livePages()) {
    if (page.closing || page.context.frozen) continue;
    if (!page.context.onLine)
      await world.apply({ kind: 'online', page: page.id });
    if (page.context.visibilityState === 'hidden')
      await world.apply({ kind: 'show', page: page.id });
  }
  await quiesce(world, QUIET_MS);
  for (const page of world.livePages()) {
    if (page.closing || page.context.frozen) continue;
    world.sim.runIn(page.context, () => page.read(true));
  }
  await world.sim.settle();
  await quiesce(world, 30_000);
}

/** A violation's key says which faults led to it, so one symptom reached
 * different ways (an engine crash, a reload) reads as two. */
function found(world: World): FoundViolation[] {
  const faults = [...new Set(world.injected)].sort();
  return check(world).map((violation) => ({
    symptom: violation.symptom,
    faults,
    reordered: world.reordered > 0,
    detail: violation.detail,
  }));
}

/** Drops findings that a subset of their faults shows as well. */
export function minimal<T extends ViolationKey>(findings: T[]): T[] {
  return findings.filter(
    (wide) =>
      !findings.some(
        (narrow) =>
          violationKey(narrow) !== violationKey(wide) && explains(narrow, wide)
      )
  );
}

function describeStep(step: World['steps'][number]): string {
  if (step.kind === 'fault') return `fault ${step.fault}`;
  if (step.kind === 'timer') return `timer ${step.label}`;
  return `deliver ${step.channel} ${step.summary}`;
}

export async function runSchedule(
  scenario: Scenario,
  prefix: number[]
): Promise<RunResult> {
  const world = new World(scenario);
  world.install();
  try {
    await boot(world);
    const start = world.sim.now;
    const records: StepRecord[] = [];
    const choices: number[] = [];
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (world.sim.now - start > scenario.horizonMs) break;
      const options = world.options();
      const faults: Fault[] = world.faults();
      if (options.length === 0 && faults.length === 0) break;
      // With nothing left to deliver, choice 0 ends the fault phase, so a
      // fault always costs a choice of its own.
      const faultStart = Math.max(options.length, 1);
      const choice = prefix[step] ?? 0;
      const signature = world.signature();
      const delays = options.filter((option) => option.delay).length;
      records.push({
        choice,
        options: faultStart + faults.length,
        faultStart,
        delays,
        signature,
      });
      choices.push(choice);
      if (choice < faultStart) {
        const option = options[choice];
        if (!option) break;
        if (option.delay) world.reordered += 1;
        await option.run();
      } else {
        const fault = faults[choice - faultStart];
        if (!fault) break;
        await world.apply(fault);
      }
    }
    await quiet(world);
    return {
      choices,
      records,
      violations: found(world),
      steps: world.steps.map(describeStep),
    };
  } finally {
    world.uninstall();
  }
}

function cost(records: StepRecord[], upTo: number) {
  let faults = 0;
  let delays = 0;
  for (let index = 0; index < upTo; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.choice >= record.faultStart) faults += 1;
    else if (record.choice > 0) delays += 1;
  }
  return { faults, delays };
}

export async function explore(
  scenario: Scenario,
  bound: Bound
): Promise<ExplorationReport> {
  const report: ExplorationReport = {
    scenario: scenario.name,
    bound,
    runs: 0,
    pruned: 0,
    truncated: false,
    findings: [],
  };
  const byKey = new Map<string, Finding>();
  const branched = new Map<string, Budget[]>();
  const stack: number[][] = [[]];
  while (stack.length > 0) {
    if (report.runs >= bound.maxRuns) {
      report.truncated = true;
      break;
    }
    const prefix = stack.pop() as number[];
    const result = await runSchedule(scenario, prefix);
    report.runs += 1;
    for (const violation of result.violations) {
      const key = violationKey(violation);
      const seen = byKey.get(key);
      const finding = {
        ...violation,
        steps: result.steps,
        choices: result.choices,
        runs: (seen?.runs ?? 0) + 1,
      };
      byKey.set(
        key,
        seen && seen.steps.length <= result.steps.length
          ? { ...seen, runs: finding.runs }
          : finding
      );
    }
    for (let index = prefix.length; index < result.records.length; index += 1) {
      const record = result.records[index];
      if (!record) continue;
      const used = cost(result.records, index);
      const left: Budget = {
        faults: bound.maxFaults - used.faults,
        delays: bound.maxDelays - used.delays,
      };
      if (bound.prune !== false) {
        const earlier = branched.get(record.signature) ?? [];
        const covered = earlier.some(
          (budget) =>
            budget.faults >= left.faults && budget.delays >= left.delays
        );
        if (covered) {
          report.pruned += 1;
          continue;
        }
        branched.set(record.signature, [...earlier, left]);
      }
      const base = result.choices.slice(0, index);
      for (let choice = 1; choice < record.options; choice += 1) {
        const isFault = choice >= record.faultStart;
        if (isFault ? left.faults <= 0 : left.delays <= 0) continue;
        stack.push([...base, choice]);
      }
    }
  }
  report.findings = minimal([...byKey.values()]);
  return report;
}

/** One step of a scripted run: a fault, or time passing on the default schedule. */
export type ScriptStep = Fault | { waitMs: number };

/**
 * Runs a fixed fault sequence on the default schedule, for defects that need
 * more faults than exploration reaches (a restart loop, say).
 */
export async function runScript(
  pages: number[],
  script: ScriptStep[]
): Promise<RunResult> {
  const world = new World({ name: 'script', pages, faults: [], horizonMs: 0 });
  world.install();
  try {
    await boot(world);
    for (const step of script) {
      if ('waitMs' in step) await quiesce(world, step.waitMs);
      else await world.apply(step);
    }
    await quiet(world);
    return {
      choices: [],
      records: [],
      violations: found(world),
      steps: world.steps.map(describeStep),
    };
  } finally {
    world.uninstall();
  }
}
