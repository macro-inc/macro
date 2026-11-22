import { onTestFinished } from 'vitest';

export type LifetimeOutcome =
  | { status: 'released'; errors: unknown[] }
  | { status: 'retained'; errors: unknown[] };

/**
 * Join every pending piece of work, each within `boundMs`, then run the
 * releases in reverse registration order. If any join does not settle in
 * time, nothing is released: the resources stay with the still-pending work.
 */
export async function joinThenRelease(
  joins: readonly (() => Promise<unknown>)[],
  releases: readonly (() => unknown)[],
  boundMs: number
): Promise<LifetimeOutcome> {
  const errors: unknown[] = [];
  let unsettled = false;
  for (const join of joins) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol('timed out');
    try {
      const joined = await Promise.race([
        join(),
        new Promise<typeof timedOut>((resolve) => {
          timer = setTimeout(() => resolve(timedOut), boundMs);
        }),
      ]);
      if (joined === timedOut) unsettled = true;
    } catch (error) {
      errors.push(error);
    } finally {
      clearTimeout(timer);
    }
  }
  if (unsettled) return { status: 'retained', errors };
  for (const release of [...releases].reverse()) {
    try {
      await release();
    } catch (error) {
      errors.push(error);
    }
  }
  return { status: 'released', errors };
}

/** Set once a case retains its resources; every later case refuses to start. */
let stoppedBy: string | undefined;
/** Resources of an unsettled case, kept reachable for the rest of the job. */
const retained: (readonly (() => unknown)[])[] = [];

/**
 * One finalizer per case owns its joins and releases, so no release can start
 * before the case's pending work has settled. An unsettled case retains its
 * resources and stops the job.
 */
export function caseLifetime(name: string, boundMs = 1000) {
  if (stoppedBy !== undefined)
    throw new Error(`Job stopped: case '${stoppedBy}' did not settle`);
  const joins: (() => Promise<unknown>)[] = [];
  const releases: (() => unknown)[] = [];
  onTestFinished(async () => {
    const outcome = await joinThenRelease(joins, releases, boundMs);
    if (outcome.status === 'retained') {
      stoppedBy = name;
      retained.push(releases);
      throw new AggregateError(
        outcome.errors,
        `Case '${name}' did not settle: its resources are retained and the job is stopped`
      );
    }
    if (outcome.errors.length === 1) throw outcome.errors[0];
    if (outcome.errors.length > 1)
      throw new AggregateError(outcome.errors, `Case '${name}' cleanup failed`);
  });
  return {
    /** Work to settle and await before any release. */
    join(work: () => Promise<unknown>) {
      joins.push(work);
    },
    /** A release, run after every join, in reverse registration order. */
    release(release: () => unknown) {
      releases.push(release);
    },
  };
}

export type CaseLifetime = ReturnType<typeof caseLifetime>;
