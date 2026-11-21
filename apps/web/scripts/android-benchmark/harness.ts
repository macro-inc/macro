import type { Device } from './device';
import { type Sample, sampleFrom, type Variant } from './measure';
import type { CapturedSpan } from './otlp';
import {
  NOT_IN_LIST,
  row,
  type Scenario,
  SHOWS_UNREAD,
  type Step,
  UNREAD,
} from './scenarios';
import { type Located, Session } from './session';
import {
  candidates,
  chooseCandidate,
  type Observation,
  type TargetChoice,
  type TargetKey,
  type Targets,
  type TargetsFile,
} from './targets';

export const sleep = (ms: number) =>
  new Promise((done) => setTimeout(done, ms));

/** The least time a list gets to come to rest after scrolling to a target. */
const SCROLL_SETTLE_MS = 1000;

/**
 * Finds the step's target, untimed. When the page had to scroll to it, waits
 * for the list to come to rest and finds it again, so the scroll and the work
 * it starts stay out of the timed interval.
 */
async function settledTarget(
  session: Session,
  expression: string
): Promise<Located> {
  let point = await session.waitFor(expression);
  for (let attempt = 0; point.moved; attempt++) {
    if (attempt === 3) throw new Error('The target kept moving');
    await sleep(SCROLL_SETTLE_MS);
    // A scroll can load further pages; wait for them and their rows too.
    await session.waitForQuiet();
    point = await session.waitFor(expression);
  }
  return point;
}

async function waitForTap(session: Session, since: number): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const tap = await session.tapAfter(since);
    if (tap !== undefined) return tap;
    await sleep(50);
  }
  throw new Error('The page never saw the tap');
}

/** Taps the step's target, then waits for its spans; returns the sample. */
export async function measureStep(
  session: Session,
  step: Step,
  targets: Targets,
  variant: Variant,
  iteration: number,
  holdMs?: number
): Promise<Sample> {
  // The checks before and after bracket the step: the rate cannot lapse and
  // come back in between, because it lasts as long as the connection.
  const throttleBefore = await session.checkCpuThrottle();
  const point = await settledTarget(session, step.target(targets));
  const tap = { variant, iteration, point, throttleBefore, holdMs };
  if (!step.ready.visible) return tapAndMeasure(session, step, targets, tap);
  await session.watchContent(step.ready.visible);
  try {
    return await tapAndMeasure(session, step, targets, tap);
  } finally {
    // A step that failed early would leave the watcher running into the next.
    await session.stopWatchingContent();
  }
}

/** Taps the located target and waits for the step to be ready. */
async function tapAndMeasure(
  session: Session,
  step: Step,
  targets: Targets,
  {
    variant,
    iteration,
    point,
    throttleBefore,
    holdMs,
  }: {
    variant: Variant;
    iteration: number;
    point: Located;
    throttleBefore: number;
    holdMs: number | undefined;
  }
): Promise<Sample> {
  const failures = session.captureFailures;
  // The same clock as the page's event and span times.
  const before = await session.cdp.evaluate<number>(
    'performance.timeOrigin + performance.now()'
  );
  // Rows that open an item must not show unread when the touch lands.
  await session.guardTap(step.opens ? UNREAD : undefined);
  await session.device.tap(point.x, point.y, holdMs);
  let start: number;
  try {
    start = await waitForTap(session, before);
  } finally {
    await session.clearTapGuard();
  }
  const refused = await session.tapRefused();
  if (refused) throw new Error(`${step.id}: touch dropped, ${refused}`);
  const root = await session.waitForSpan(
    (span) => span.start >= start && step.ready.root(span),
    start
  );
  if (!root) throw new Error(`${step.id}: no root span after the tap`);
  const extra: CapturedSpan[] = [];
  for (const match of step.ready.also ?? []) {
    const span = await session.waitForSpan(
      (candidate) => candidate.start >= start && match(candidate),
      start
    );
    if (!span) throw new Error(`${step.id}: content span never ended`);
    extra.push(span);
  }
  let contentPainted: number | undefined;
  if (step.ready.visible) {
    contentPainted = await session.contentPainted();
    if (contentPainted === undefined)
      throw new Error(`${step.id}: ${step.ready.visible} never appeared`);
  }
  const route = await session.route();
  if (!route.includes(step.route(targets)))
    throw new Error(
      `${step.id}: landed on ${route}, not ${step.route(targets)}`
    );
  await session.captured();
  // A lost export may hold this step's child spans; its counts would be wrong.
  if (session.captureFailures > failures)
    throw new Error(`${step.id}: a trace export could not be read`);
  const throttleAfter = await session.checkCpuThrottle();
  return {
    ...sampleFrom(session, step.id, variant, iteration, start, root, extra, contentPainted),
    cpuThrottleMeasured: [throttleBefore, throttleAfter],
  };
}

/** Force-stops and relaunches the app, attaches, and waits for its boot. */
export async function launchFresh(
  device: Device,
  port: number
): Promise<{ session: Session; launched: number; boot: CapturedSpan }> {
  await device.forceStop();
  await sleep(1000);
  const launched = await device.launch();
  const session = await Session.attach(device, port);
  const boot = await session.waitForSpan(
    (span) => span.name === 'app.boot',
    launched,
    30_000
  );
  if (!boot) {
    await session.detach();
    throw new Error(
      'No app.boot span: it was exported before DevTools attached, or the app is signed out'
    );
  }
  return { session, launched, boot };
}

/**
 * Waits for the boot `view.app` flow to settle. While it is open, a view the
 * first dock tap opens becomes one of its phases instead of the tap's own
 * navigation, which then ends early and reports a fraction of the switch.
 */
export async function waitForBootFlow(
  session: Session,
  launched: number,
  // The app ends a flow after 30 s; its export can take five more.
  timeoutMs = 60_000
): Promise<CapturedSpan> {
  const flow = await session.waitForSpan(
    (span) => span.name === 'view.app' && span.start >= launched,
    launched,
    timeoutMs
  );
  if (!flow) throw new Error('The boot view.app flow never ended');
  return flow;
}

/**
 * Classifies a candidate's row without opening it, and says whether finding
 * it scrolled the page.
 */
async function observe(
  session: Session,
  item: Targets[TargetKey],
  key: TargetKey,
  scrolled: () => void
): Promise<Observation> {
  try {
    // A virtual list can replace the row as it scrolls into place: look again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const point = await session.locate(row(item, key));
      if (point?.moved) scrolled();
      if (point) return 'quiet';
      await sleep(300);
    }
    return 'missing';
  } catch (error) {
    // A search that scrolled and failed still moved the list.
    scrolled();
    const message = (error as Error).message;
    if (message.includes(SHOWS_UNREAD)) return 'unread';
    if (message.includes(NOT_IN_LIST)) return 'missing';
    throw error;
  }
}

/**
 * Untimed taps that bring the app to a scenario's start. Then checks the
 * route and finds the row of each item the scenario opens, choosing the first
 * of a key's candidates that shows no unread, and returns the chosen items.
 * Throws when the app is elsewhere or an item cannot be opened, before any
 * of the scenario's steps run.
 */
export async function prepare(
  session: Session,
  scenario: Scenario,
  file: TargetsFile,
  settleMs: number
): Promise<{ targets: Targets; choices: TargetChoice[] }> {
  for (const target of scenario.prepare ?? []) {
    const point = await session.waitFor(target({}));
    await session.device.tap(point.x, point.y);
    await sleep(settleMs);
  }
  if (scenario.preparedRoute) {
    const route = await session.route();
    if (!route.includes(scenario.preparedRoute))
      throw new Error(`Prepared ${route}, not ${scenario.preparedRoute}`);
  }
  const targets: Targets = {};
  const choices: TargetChoice[] = [];
  if (!scenario.opens?.length) return { targets, choices };
  // The list may still be loading: wait for any row first.
  await session.waitFor(`document.querySelectorAll('[data-soup-entity]')`);
  let moved = false;
  for (const key of scenario.opens) {
    const items = candidates(file, key);
    const { choice, skipped } = await chooseCandidate(key, items, (item) =>
      observe(session, item, key, () => {
        moved = true;
      })
    );
    for (const reason of skipped) console.warn(`  ${reason}; skipped`);
    targets[key] = items[choice.index];
    choices.push(choice);
  }
  await sleep(settleMs);
  // Pages a search's scrolling started must not land in the first step.
  if (moved) await session.waitForQuiet();
  return { targets, choices };
}
