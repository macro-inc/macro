import type { PaneId } from '../routes/types';
import { isPromise, type MaybePromise, mapMaybe, settleMaybe } from '../utils';
import type { LeaveGuard, LeaveGuardContext } from './types';

type RegisteredGuard = { pane: PaneId; depth: number; guard: LeaveGuard };

/** One guard bound to what it is asked about. */
export type Check = () => MaybePromise<boolean>;

export type LeaveGuards = ReturnType<typeof createLeaveGuards>;

/**
 * Where guards from a pane's chrome sit: above its first route, as inside a
 * `<PaneScope>`. Only removing the pane or leaving the router asks them.
 */
export const PANE_LEVEL = -1;

export function createLeaveGuards() {
  const registered: RegisteredGuard[] = [];

  return {
    /** `depth` is the outlet depth of the view that registers the guard. */
    register(pane: PaneId, depth: number, guard: LeaveGuard): () => void {
      const item = { pane, depth, guard };
      registered.push(item);

      return () => {
        const index = registered.indexOf(item);
        if (index >= 0) registered.splice(index, 1);
      };
    },

    forget(pane: PaneId): void {
      for (let index = registered.length - 1; index >= 0; index -= 1) {
        if (registered[index]!.pane === pane) registered.splice(index, 1);
      }
    },

    /** Guards of `pane` at or below `fromDepth`, i.e. those a navigation from there unmounts. */
    select(pane: PaneId, fromDepth: number): LeaveGuard[] {
      const unmounted = (item: RegisteredGuard) =>
        item.pane === pane && item.depth >= fromDepth;

      return registered.filter(unmounted).map((item) => item.guard);
    },
  };
}

export function checksFor(
  guards: readonly LeaveGuard[],
  context: LeaveGuardContext
): Check[] {
  return guards.map((guard) => () => guard(context));
}

function allowOnError(error: unknown): boolean {
  console.error('Split router leave guard failed', error);

  return true;
}

function resumeChecks(
  verdict: Promise<boolean>,
  checks: readonly Check[],
  next: number
): MaybePromise<boolean> {
  return mapMaybe(
    verdict,
    (allowed) => allowed && runChecks(checks.slice(next))
  );
}

/** Runs checks in order until one refuses; a failing guard is logged and allows. */
export function runChecks(checks: readonly Check[]): MaybePromise<boolean> {
  for (const [position, check] of checks.entries()) {
    const verdict = settleMaybe(check, allowOnError);

    if (isPromise(verdict)) {
      return resumeChecks(verdict, checks, position + 1);
    }

    if (!verdict) return false;
  }

  return true;
}
