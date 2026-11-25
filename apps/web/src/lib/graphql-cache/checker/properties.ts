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
 * S2 a live page never drops its host, short of a newer build taking over, and
 *    never asks to reload without one.
 * S3 a write that reached the durable queue stays in it.
 * S4 no older build opens the database after a newer one.
 * S5 a refused request says why, with an error code.
 * S6 nothing throws out of an event handler or a timer.
 * L1 every live page has its cache back: its host answers a read and takes a draft.
 * L2 an engine of the newest build is active while any page is live.
 * L3 every request a live page made has settled.
 *
 * A frozen page is exempt from the L properties until it thaws; a page that asked
 * to reload for a newer build is exempt from L1, and does not count as live in L2.
 * While a frozen page's engine keeps the database's lock nobody else can open it:
 * L1 and L2 then only need the pages told (paused) and the coordinator trying.
 */
import { getOrCreateCacheScope } from '../scope';
import { databaseOwnerLockName } from '../worker/coordinator-protocol';
import type { CallOutcome, Page, World } from './world';

export type Violation = {
  symptom: string;
  detail: string;
};

/**
 * After the last fault, how long a page has to get its cache back (T in the
 * property). The code's own waits fit well inside it: the owner-lock budget
 * (about 11.4 s), the open deadline (20 s), the page backoff cap (30 s), the
 * recovery healthy window (60 s) and the engine's asset load (5 min).
 */
export const QUIET_MS = 6 * 60_000;

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

/** Whether a frozen engine, which nobody can end, has the database. */
const heldByFrozen = (world: World): boolean =>
  world.sim.locks
    .holders(databaseOwnerLockName(getOrCreateCacheScope()))
    .some(({ frozen }) => frozen);

/** How a page that should have its cache back does not. */
function cacheState(page: Page, probes: CallOutcome[]): string {
  const parts: string[] = [page.recovery.state()];
  if (page.stops.length > 0) parts.push(`stopped ${page.stops.join('+')}`);
  if (probes.length === 0) parts.push('probe read not made');
  for (const { kind, result, error } of probes) {
    if (result === undefined) parts.push(`probe ${kind} pending`);
    else if (result === 'error')
      parts.push(`probe ${kind} ${errorClass(error)}`);
  }
  return parts.join(', ');
}

/** What became of a queued write that is not in the queue any more. */
function lostBecause(world: World, admittedTo: string, scope: string): string {
  if (admittedTo !== scope)
    return world.engines.some(({ core }) => core?.serving === admittedTo)
      ? 'scope changed, old database still open'
      : 'scope changed';
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
    .filter(({ error }) => !superseded(error))
    .map(({ page, error, at }) => ({
      symptom: `S2:host retired on ${errorClass(error)}`,
      detail: `${page} at ${at}`,
    }));
}

function needlessReloads(world: World): Violation[] {
  return world.reloadRequests
    .filter((id) => {
      const build = pageOf(world, id)?.context.buildTime ?? 0;
      return !world.pages.some(({ context }) => context.buildTime > build);
    })
    .map((id) => ({
      symptom: 'S2:asked to reload without a newer build',
      detail: id,
    }));
}

function lostWrites(world: World): Violation[] {
  const scope = getOrCreateCacheScope();
  const { queue } = world.storage.database(scope);
  const neverStored = world.calls
    .filter(
      ({ kind, result, uuid }) =>
        kind === 'draft' &&
        result === 'ok' &&
        !world.storage.admitted.has(uuid ?? '')
    )
    .map(({ page }) => ({
      symptom: 'S3:accepted write never stored',
      detail: page,
    }));
  const lost = [...world.storage.admitted]
    .filter(([uuid]) => !queue.has(uuid))
    .map(([uuid, admittedTo]) => ({
      symptom: `S3:queued write lost (${lostBecause(world, admittedTo, scope)})`,
      detail: uuid,
    }));
  return [...neverStored, ...lost];
}

function olderOpens(world: World): Violation[] {
  const violations: Violation[] = [];
  const newest = new Map<string, number>();
  for (const { scope, buildTime, engine } of world.storage.opens) {
    const before = newest.get(scope) ?? buildTime;
    if (buildTime < before)
      violations.push({
        symptom: 'S4:older build opened after newer',
        detail: engine,
      });
    newest.set(scope, Math.max(before, buildTime));
  }
  return violations;
}

function uncodedRefusals(world: World): Violation[] {
  return world.calls
    .filter(
      ({ result, moot, error }) =>
        result === 'error' &&
        !moot &&
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
    const probes = world.calls.filter(
      (call) => call.page === page.id && call.probe === true
    );
    const back =
      page.host !== undefined &&
      !page.host.disabled &&
      !page.cacheOff &&
      page.recovery.state() === 'ready' &&
      probes.length > 0 &&
      probes.every(({ result }) => result === 'ok');
    if (back || (page.host?.paused && heldByFrozen(world))) continue;
    violations.push({
      symptom: `L1:cache not back (${cacheState(page, probes)})`,
      detail: page.id,
    });
  }
  return violations;
}

function missingEngine(world: World, pages: Page[]): Violation[] {
  const live = pages.filter(({ id }) => !world.reloadRequests.includes(id));
  if (live.length === 0) return [];
  const newest = Math.max(...live.map((page) => page.context.buildTime));
  const scope = getOrCreateCacheScope();
  const state = [...world.coordinators.values()]
    .filter(({ buildTime }) => buildTime === newest)
    .findLast((coordinator) => coordinator.scope() === scope)
    ?.coreState();
  if (state?.startsWith('active')) return [];
  if (state?.startsWith('resetting-after-loss') && heldByFrozen(world))
    return [];
  return [
    {
      symptom: `L2:no active engine (${state?.replace(/[@:/].*/, '') ?? 'no coordinator'})`,
      detail: state ?? '',
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
    ...needlessReloads(world),
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
