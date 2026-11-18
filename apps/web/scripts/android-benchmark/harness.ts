import type { Device } from './device';
import { type Sample, sampleFrom, type Variant } from './measure';
import type { CapturedSpan } from './otlp';
import type { Scenario, Step, Targets } from './scenarios';
import { Session } from './session';

export const sleep = (ms: number) =>
  new Promise((done) => setTimeout(done, ms));

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
  const point = await session.waitFor(step.target(targets));
  const failures = session.captureFailures;
  // The same clock as the page's event and span times.
  const before = await session.cdp.evaluate<number>(
    'performance.timeOrigin + performance.now()'
  );
  await session.device.tap(point.x, point.y, holdMs);
  const start = await waitForTap(session, before);
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
    ...sampleFrom(session, step.id, variant, iteration, start, root, extra),
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

/** Untimed taps that bring the app to a scenario's start. */
export async function prepare(
  session: Session,
  scenario: Scenario,
  targets: Targets,
  settleMs: number
) {
  for (const target of scenario.prepare ?? []) {
    const point = await session.waitFor(target(targets));
    await session.device.tap(point.x, point.y);
    await sleep(settleMs);
  }
}
