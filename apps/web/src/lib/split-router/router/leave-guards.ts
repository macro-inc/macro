import deepEqual from 'fast-deep-equal';
import type { PaneId } from '../routes/types';
import { isPromise, type MaybePromise, mapMaybe, settleMaybe } from '../utils';
import type { LeaveGuard, LeaveGuardContext, LeaveGuardOptions } from './types';

type RegisteredGuard = {
  pane: PaneId;
  depth: number;
  guard: LeaveGuard;
  options: LeaveGuardOptions;
};

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
    register(
      pane: PaneId,
      depth: number,
      guard: LeaveGuard,
      options: LeaveGuardOptions = {}
    ): () => void {
      const item = { pane, depth, guard, options };
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

    /** Select unmount guards and explicitly watched search changes. */
    select(
      pane: PaneId,
      fromDepth: number | undefined,
      context?: LeaveGuardContext
    ): LeaveGuard[] {
      const relevant = (item: RegisteredGuard) => {
        if (item.pane !== pane) return false;
        if (fromDepth !== undefined && item.depth >= fromDepth) return true;
        return (
          !!context?.to &&
          !!item.options.search?.some(
            (namespace) =>
              !deepEqual(
                context.from.location.search?.[namespace],
                context.to?.location.search?.[namespace]
              )
          )
        );
      };
      return registered.filter(relevant).map((item) => item.guard);
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
