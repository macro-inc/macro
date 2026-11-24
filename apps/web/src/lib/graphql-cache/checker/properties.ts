/**
 * The handover property, checked on a finished run. Safety (S) holds over the
 * whole run; liveness (L) is checked after the quiet phase, when faults have
 * stopped and every live page has been visible and online for `QUIET_MS`.
 *
 * Each violation's `symptom` is the property and a coarse, schedule-independent
 * description of how it broke, so the same defect reached by many schedules
 * reads as one.
 *
 * S1 one engine has a database open at a time.
 * S2 a live page never drops its host, short of a newer build taking over.
 * S3 a write that reached the durable queue stays in it.
 * S4 no older build opens the database after a newer one.
 * S5 a refused request says why, with an error code.
 * S6 nothing throws out of an event handler or a timer.
 * L1 every live page has its cache back, and its host answers a read.
 * L2 an engine is active while any page is live.
 * L3 every request a live page made has settled.
 *
 * A frozen page is exempt from the L properties until it thaws; a page that asked to
 * reload for a newer build is exempt from L1.
 */
import { getOrCreateCacheScope } from '../scope';
import type { CallOutcome, Page, World } from './world';

export type Violation = {
  symptom: string;
  detail: string;
};

/**
 * After the last fault, how long a page has to get its cache back (T in the
 * property). The code's own waits fit well inside it: the owner-lock budget
 * (about 11.4 s), the open deadline (20 s), the page backoff cap (30 s) and
 * the recovery healthy window (60 s).
 */
export const QUIET_MS = 3 * 60_000;

export function errorClass(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = (error as { errorCode?: unknown }).errorCode;
  const reason = (error as { unavailableReason?: unknown }).unavailableReason;
  return [
    error.name,
    typeof code === 'string' ? code : 'untyped',
    typeof reason === 'string' ? reason : undefined,
    typeof code === 'string' ? undefined : error.message,
  ]
    .filter((part) => part !== undefined)
    .join(':');
}

/** How a page that should have its cache back does not. */
function cacheState(page: Page, probe: CallOutcome | undefined): string {
  const parts: string[] = [page.recovery.state()];
  if (page.stops.length > 0) parts.push(`stopped ${page.stops.join('+')}`);
  if (!probe) parts.push('probe read not made');
  else if (probe.result === undefined) parts.push('probe read pending');
  else if (probe.result === 'error')
    parts.push(`probe read ${errorClass(probe.error)}`);
  return parts.join(', ');
}

/** What became of a queued write that is not in the queue any more. */
function lostBecause(world: World, admittedTo: string, scope: string): string {
  if (admittedTo !== scope) return 'scope changed';
  if (world.storage.database(admittedTo).wipes > 0) return 'database wiped';
  return 'removed';
}

const superseded = (error: unknown): boolean =>
  (error as { errorCode?: unknown } | undefined)?.errorCode ===
  'cache-superseded';

const exempt = (page: Page | undefined): boolean =>
  !page || page.closing || page.context.frozen;

const pageOf = (world: World, id: string): Page | undefined =>
  world.pages.find((page) => page.id === id);

function retirements(world: World): Violation[] {
  return world.retirements
    .filter(
      ({ page, error }) =>
        pageOf(world, page)?.closing === false && !superseded(error)
    )
    .map(({ page, error, at }) => ({
      symptom: `S2:host retired on ${errorClass(error)}`,
      detail: `${page} at ${at}`,
    }));
}

function lostWrites(world: World): Violation[] {
  const scope = getOrCreateCacheScope();
  const { queue } = world.storage.database(scope);
  return [...world.storage.admitted]
    .filter(([uuid]) => !queue.has(uuid))
    .map(([uuid, admittedTo]) => ({
      symptom: `S3:queued write lost (${lostBecause(world, admittedTo, scope)})`,
      detail: uuid,
    }));
}

function olderOpens(world: World): Violation[] {
  const violations: Violation[] = [];
  let newest = Number.NEGATIVE_INFINITY;
  for (const open of world.storage.opens) {
    if (open.buildTime < newest)
      violations.push({
        symptom: 'S4:older build opened after newer',
        detail: open.engine,
      });
    newest = Math.max(newest, open.buildTime);
  }
  return violations;
}

function uncodedRefusals(world: World): Violation[] {
  return world.calls
    .filter(
      ({ page, result, error }) =>
        result === 'error' &&
        pageOf(world, page)?.closing === false &&
        typeof (error as { errorCode?: unknown }).errorCode !== 'string' &&
        (error as Error).name !== 'CacheNavigationError'
    )
    .map(({ page, kind, error }) => ({
      symptom: `S5:${kind} refused without a code: ${errorClass(error)}`,
      detail: page,
    }));
}

function cachesNotBack(world: World, live: Page[]): Violation[] {
  const violations: Violation[] = [];
  for (const page of live) {
    if (world.reloadRequests.includes(page.id)) continue;
    const probe = world.calls.findLast(
      (call) => call.page === page.id && call.probe === true
    );
    const back =
      page.host !== undefined &&
      !page.host.disabled &&
      !page.cacheOff &&
      page.recovery.state() === 'ready' &&
      probe?.result === 'ok';
    if (back) continue;
    violations.push({
      symptom: `L1:cache not back (${cacheState(page, probe)})`,
      detail: page.id,
    });
  }
  return violations;
}

function missingEngine(world: World, live: Page[]): Violation[] {
  const newest = Math.max(...live.map((page) => page.context.buildTime));
  const state = world.coordinators.get(newest)?.coreState();
  if (state === undefined || state.startsWith('active')) return [];
  return [
    {
      symptom: `L2:no active engine (${state.replace(/[@:/].*/, '')})`,
      detail: state,
    },
  ];
}

function unsettledCalls(world: World): Violation[] {
  return world.calls
    .filter(
      ({ page, result }) => result === undefined && !exempt(pageOf(world, page))
    )
    .map(({ page, kind, issuedAt }) => ({
      symptom: `L3:${kind} never settled`,
      detail: `${page} since ${issuedAt}`,
    }));
}

export function check(world: World): Violation[] {
  const live = world.livePages().filter((page) => !exempt(page));
  return [
    ...world.storage.openConflicts.map((detail) => ({
      symptom: 'S1:two engines open',
      detail,
    })),
    ...retirements(world),
    ...lostWrites(world),
    ...olderOpens(world),
    ...uncodedRefusals(world),
    ...world.sim.uncaught.map((error) => ({
      symptom: `S6:uncaught ${errorClass(error)}`,
      detail: String(error),
    })),
    ...cachesNotBack(world, live),
    ...missingEngine(world, live),
    ...unsettledCalls(world),
  ];
}
