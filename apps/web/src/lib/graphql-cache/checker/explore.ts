/**
 * Systematic exploration: every schedule of a scenario with at most
 * `maxFaults` injected faults and at most `maxDelays` delays, within the
 * scenario's horizon. A delay delivers a later channel's message before the
 * oldest one or, where the scenario has late messages, holds the oldest back
 * until one of the armed timers is due. Runs are replayed from scratch from
 * their choices.
 * A branch is skipped when the same state (`World.signature`) was already
 * branched from with at least the same budget left, and the report says how
 * many it pruned.
 */
import { check, QUIET_MS } from './properties';
import { isHeartbeat } from './sim';
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
  /** Of the state before the step; none on the replayed part of a run. */
  signature: string | undefined;
};

export type RunResult = {
  choices: number[];
  records: StepRecord[];
  violations: FoundViolation[];
  steps: string[];
  /** A step cap ended a phase early, so the run says less than it claims. */
  cutShort: boolean;
};

/** A violation and the faults that led to it, sorted, repeats kept. */
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
  const times = new Map<string, number>();
  for (const fault of faults) times.set(fault, (times.get(fault) ?? 0) + 1);
  const named = [...times].map(([fault, count]) =>
    count > 1 ? `${fault}×${count}` : fault
  );
  const how = named.length > 0 ? named.join('+') : 'no fault';
  return `${symptom} [${how}${reordered ? ', reordered' : ''}]`;
}

const count = (faults: string[], fault: string): number =>
  faults.filter((other) => other === fault).length;

/** Whether `narrow` shows the same symptom as `wide` with no more to cause it. */
export function explains(narrow: ViolationKey, wide: ViolationKey): boolean {
  return (
    narrow.symptom === wide.symptom &&
    (wide.reordered || !narrow.reordered) &&
    narrow.faults.every(
      (fault) => count(wide.faults, fault) >= count(narrow.faults, fault)
    )
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
  /** Runs a step cap ended early. */
  cutShort: number;
  /** Each distinct violation, less those a simpler cause also shows. */
  findings: Finding[];
};

const MAX_STEPS = 600;

/** Steps of heartbeats alone, two rounds of them, that show a steady state. */
const HEARTBEAT_ROUNDS = 6;

/**
 * Opens the scenario's pages and gives each its workload, a draft and a
 * read, at once, as the app does before its cache is ready. Faults can land
 * from the first step on, so startup is explored too.
 */
async function boot(world: World): Promise<void> {
  for (const buildTime of world.scenario.pages) await world.openPage(buildTime);
  for (const page of world.pages)
    world.sim.runIn(page.context, () => page.work());
  await world.sim.settle();
}

/** A coordinator's heartbeat timer, the message or its answer. */
const isHeartbeatStep = (step: World['steps'][number] | undefined): boolean =>
  step !== undefined &&
  ((step.kind === 'timer' && isHeartbeat(step.label)) ||
    (step.kind === 'deliver' && isHeartbeat(step.summary)));

/** Whether heartbeats have gone round, all answered, with nothing else going on. */
const onlyHeartbeats = (world: World): boolean =>
  world.steps.slice(-HEARTBEAT_ROUNDS).every(isHeartbeatStep);

/**
 * Runs the default schedule for `ms`; false if the step cap ended it first.
 * While nothing but answered heartbeats is going on, time skips to what is next.
 */
async function quiesce(world: World, ms: number): Promise<boolean> {
  const until = world.sim.now + ms;
  for (let step = 0; step < 20_000; step += 1) {
    const [next] = world.options();
    const timer = next?.timer;
    if (!next || (timer && timer.at > until)) {
      world.sim.advanceTo(until);
      return true;
    }
    if (timer && isHeartbeat(timer.label) && onlyHeartbeats(world)) {
      const other = world.sim.nextTimer((each) => !isHeartbeat(each.label));
      world.sim.advanceTo(Math.min(other?.at ?? until, until));
      if (!other || other.at > until) return true;
      await world.runTimer(other);
      continue;
    }
    await next.run();
  }
  return false;
}

/**
 * Faults stop: every live page comes online and is shown, except a frozen
 * one. A background page can stay frozen for as long as the browser likes,
 * so it stays hidden and frozen, and the other pages must not need it.
 */
async function quiet(world: World): Promise<boolean> {
  world.quiet = true;
  world.sim.releaseLate();
  for (const page of world.livePages()) {
    if (page.closing || page.context.frozen) continue;
    if (!page.context.onLine)
      await world.apply({ kind: 'online', page: page.id });
    if (page.context.visibilityState === 'hidden')
      await world.apply({ kind: 'show', page: page.id });
  }
  const settled = await quiesce(world, QUIET_MS);
  for (const page of world.livePages()) {
    if (page.closing || page.context.frozen) continue;
    world.sim.runIn(page.context, () => page.work(true));
  }
  await world.sim.settle();
  return (await quiesce(world, 30_000)) && settled;
}

/** A violation's key says which faults led to it, so one symptom reached
 * different ways (an engine crash, a reload) reads as two. */
function found(world: World): FoundViolation[] {
  const faults = [...world.injected].sort();
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
  if (step.kind === 'hold') return `hold ${step.channel} until ${step.label}`;
  return `deliver ${step.channel} ${step.summary}`;
}

export async function runSchedule(
  scenario: Scenario,
  prefix: number[]
): Promise<RunResult> {
  const world = new World(scenario);
  try {
    world.install();
    await boot(world);
    const start = world.sim.now;
    const records: StepRecord[] = [];
    const choices: number[] = [];
    let cutShort = true;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      cutShort = false;
      if (world.sim.now - start > scenario.horizonMs) break;
      const options = world.options();
      const faults: Fault[] = world.faults();
      if (options.length === 0 && faults.length === 0) break;
      // With nothing left to deliver, choice 0 ends the fault phase, so a
      // fault always costs a choice of its own.
      const faultStart = Math.max(options.length, 1);
      const choice = prefix[step] ?? 0;
      const signature = step < prefix.length ? undefined : world.signature();
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
        if (option.reorders) world.reordered += 1;
        await option.run();
      } else {
        const fault = faults[choice - faultStart];
        if (!fault) break;
        await world.apply(fault);
      }
      cutShort = true;
    }
    const settled = await quiet(world);
    return {
      choices,
      records,
      violations: found(world),
      steps: world.steps.map(describeStep),
      cutShort: cutShort || !settled,
    };
  } finally {
    world.uninstall();
  }
}

/** What a run's replayed part spent of its bound; what follows it is default. */
function budgetLeft(bound: Bound, replayed: StepRecord[]): Budget {
  let { maxFaults: faults, maxDelays: delays } = bound;
  for (const record of replayed) {
    if (record.choice >= record.faultStart) faults -= 1;
    else if (record.choice > 0) delays -= 1;
  }
  return { faults, delays };
}

const canBranch = (record: StepRecord, left: Budget): boolean =>
  (left.faults > 0 && record.options > record.faultStart) ||
  (left.delays > 0 && record.delays > 0);

/** Whether a state was branched from with as much budget; notes it if not. */
function covered(
  branched: Map<string, Budget[]>,
  signature: string,
  left: Budget
): boolean {
  const earlier = branched.get(signature) ?? [];
  if (
    earlier.some(
      ({ faults, delays }) => faults >= left.faults && delays >= left.delays
    )
  )
    return true;
  branched.set(signature, [...earlier, left]);
  return false;
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
    cutShort: 0,
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
    if (result.cutShort) report.cutShort += 1;
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
    const left = budgetLeft(bound, result.records.slice(0, prefix.length));
    for (let index = prefix.length; index < result.records.length; index += 1) {
      const record = result.records[index];
      if (record?.signature === undefined || !canBranch(record, left)) continue;
      if (bound.prune !== false && covered(branched, record.signature, left)) {
        report.pruned += 1;
        continue;
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
  try {
    world.install();
    await boot(world);
    let settled = true;
    for (const step of script) {
      if ('waitMs' in step)
        settled = (await quiesce(world, step.waitMs)) && settled;
      else await world.apply(step);
    }
    settled = (await quiet(world)) && settled;
    return {
      choices: [],
      records: [],
      violations: found(world),
      steps: world.steps.map(describeStep),
      cutShort: !settled,
    };
  } finally {
    world.uninstall();
  }
}
