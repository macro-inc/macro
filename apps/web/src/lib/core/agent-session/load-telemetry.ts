/**
 * Telemetry for opening a session: what a surface waited for before it could
 * render, and why the wait ended.
 *
 * The backend traces a session thoroughly once a request reaches it. What it
 * cannot see is the half that a person actually experiences — a load that
 * never resolved, a surface that gave up and released mid-fetch, or the same
 * log fetched over and over because rows kept acquiring and dropping the
 * session. That gap is what this fills: one span per attempt to open a
 * session, always ended, always carrying the outcome.
 *
 * Failures here are swallowed. Telemetry that can break a session load is
 * worse than no telemetry.
 */

import type { Span } from '@macro-inc/observability';
import { Telemetry } from '@macro-inc/observability';

/** How an attempt to open a session ended. */
export type LoadOutcome =
  /** The log was fetched and folded; the surface can render. */
  | 'loaded'
  /** Every holder released before the load finished, so nobody wanted it. */
  | 'released'
  /** The fetch or the fold failed. */
  | 'failed'
  /** Still unsettled at {@link STALL_THRESHOLD_MS} — reported, not concluded. */
  | 'stalled';

/**
 * How long a load may go unsettled before it is reported as stalled.
 *
 * A span reaches the exporter only when it ends, so a load that never
 * settles would otherwise be the one case that produces no telemetry at all —
 * precisely the case worth seeing. Past this the span is closed and reported;
 * if the load resolves afterwards it is the {@link SessionLoadTrace.end}
 * no-op, and the surface is none the wiser.
 *
 * Well past a cold load of the largest session observed (a few hundred
 * milliseconds), so a slow session is never reported as a stuck one.
 */
const STALL_THRESHOLD_MS = 15_000;

/**
 * One attempt to open a session, from the first acquisition to whatever
 * ended it.
 *
 * Held rather than run around an operation because the operation it measures
 * can be abandoned: `release` ends the span from outside the load.
 */
export class SessionLoadTrace {
  readonly #span: Span | undefined;
  readonly #startedAt = performance.now();
  #ended = false;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(sessionId: string) {
    this.#span = start('agent.session.load', sessionId);
    this.#stallTimer = setTimeout(
      () => this.end('stalled'),
      STALL_THRESHOLD_MS
    );
  }

  /** The log arrived; `rows` is what the fold is about to be given. */
  fetched(rows: number): void {
    this.#set('agent.session.log.rows', rows);
    this.#set('agent.session.load.fetch_ms', this.#since());
  }

  /** The snapshot is folded and the surface can read the session. */
  folded(foldStartedAt: number): void {
    this.#set('agent.session.load.fold_ms', performance.now() - foldStartedAt);
  }

  /**
   * End the span with how the attempt turned out. Safe to call more than
   * once; the first outcome is the one recorded, so a release racing a
   * failure does not rewrite it.
   */
  end(outcome: LoadOutcome, error?: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    clearTimeout(this.#stallTimer);
    this.#stallTimer = undefined;
    this.#set('agent.session.load.outcome', outcome);
    this.#set('agent.session.load.total_ms', this.#since());
    try {
      // A release is the expected end of an abandoned load, not a fault:
      // recording it as an error would bury the ones worth looking at.
      if (outcome === 'failed' && error !== undefined) this.#span?.error(error);
      this.#span?.end();
    } catch {
      // See the module comment.
    }
  }

  #since(): number {
    return performance.now() - this.#startedAt;
  }

  #set(name: string, value: string | number): void {
    try {
      this.#span?.setAttr(name, value);
    } catch {
      // See the module comment.
    }
  }
}

/**
 * Record that a surface took a reference to a session.
 *
 * `created` separates a shared instance being reused - free - from a new one,
 * which refetches the whole log. A session id that keeps creating instances
 * is a surface acquiring and releasing in a loop, which is invisible from the
 * backend: it sees only an unexplained run of identical log fetches.
 */
export function traceAcquire(
  sessionId: string,
  created: boolean,
  references: number
): void {
  const span = start('agent.session.acquire', sessionId);
  if (!span) return;
  try {
    span.setAttr('agent.session.acquire.created', created);
    span.setAttr('agent.session.acquire.references', references);
    span.end();
  } catch {
    // See the module comment.
  }
}

function start(name: string, sessionId: string): Span | undefined {
  try {
    const span = Telemetry.span(name);
    span.setAttr('agent.session.id', sessionId);
    return span;
  } catch {
    return undefined;
  }
}
