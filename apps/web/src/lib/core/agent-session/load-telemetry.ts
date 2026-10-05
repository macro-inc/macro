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
/** A stage of the load, named as its measure and attribute suffix. */
export type LoadStage =
  /** The cached log was looked up. */
  | 'cache_read'
  /** The cached log was folded; the surface can show it. */
  | 'cache_fold'
  /** The session row was fetched. */
  | 'session_fetch'
  /** The log was fetched. */
  | 'log_fetch'
  /** The fetched log was folded; the surface can show the truth. */
  | 'fold'
  /** A surface painted the cached transcript. */
  | 'warm_render'
  /** A surface painted the fetched transcript. */
  | 'render';

/**
 * One attempt to open a session, from the first acquisition to whatever
 * ended it.
 *
 * Every stage lands in three places: an attribute and an event on the
 * `agent.session.load` span, so a slow open can be read in Datadog; a
 * `performance.measure` named `agent.session.load.<stage>`, so the same
 * stages show in the DevTools Performance panel and can be read back with
 * `performance.getEntriesByType('measure')`; and, when
 * `window.debugAgentSessionLoad` is set, one `console.debug` line at the end
 * with everything the attempt recorded.
 *
 * Held rather than run around an operation because the operation it measures
 * can be abandoned: `release` ends the span from outside the load.
 */
export class SessionLoadTrace {
  readonly #span: Span | undefined;
  readonly #sessionId: string;
  readonly #startedAt = performance.now();
  readonly #recorded: Record<string, string | number | boolean> = {};
  #ended = false;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(sessionId: string) {
    this.#sessionId = sessionId;
    this.#span = start('agent.session.load', sessionId);
    this.#stallTimer = setTimeout(
      () => this.end('stalled'),
      STALL_THRESHOLD_MS
    );
  }

  /**
   * A stage finished: it began at `startedAt` (a `performance.now()` value)
   * and ends now. Records its duration, and its distance from the start of
   * the load as `<stage>_at_ms`, so stages that overlap (the two fetches, a
   * cache read beside them) can still be laid out on one line.
   */
  stage(
    stage: LoadStage,
    startedAt: number,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    const now = performance.now();
    const ms = now - startedAt;
    this.#set(`agent.session.load.${stage}_ms`, ms);
    this.#set(`agent.session.load.${stage}_at_ms`, now - this.#startedAt);
    for (const [name, value] of Object.entries(attributes)) {
      this.#set(`agent.session.load.${name}`, value);
    }
    try {
      this.#span?.event(`agent.session.load.${stage}`, { ms, ...attributes });
      performance.measure(`agent.session.load.${stage}`, {
        start: startedAt,
        end: now,
        detail: { sessionId: this.#sessionId, ...attributes },
      });
    } catch {
      // See the module comment.
    }
  }

  /**
   * The cached log was looked up: `hit` is what it held, or nothing. A miss
   * is a stage too; its duration is what a cold open paid for looking.
   */
  cacheRead(startedAt: number, hit: { rows: number } | undefined): void {
    this.stage('cache_read', startedAt, {
      cache_hit: hit !== undefined,
      ...(hit && { cache_rows: hit.rows }),
    });
  }

  /** The log arrived; `rows` is what the fold is about to be given. */
  fetched(startedAt: number, rows: number): void {
    this.stage('log_fetch', startedAt, { log_rows: rows });
    // Kept under its historical name: dashboards read it.
    this.#set('agent.session.log.rows', rows);
    this.#set('agent.session.load.fetch_ms', this.#since());
  }

  /** The fetched snapshot is folded and the surface can read the session. */
  folded(foldStartedAt: number): void {
    this.stage('fold', foldStartedAt);
  }

  /**
   * A surface put a transcript on screen. `cached` is the warm paint from
   * the cached log; the other is the fetched one. Measured from the start
   * of the load, which is what a person waited. Its own span rather than a
   * stage: the load span has usually ended by the time a surface paints,
   * and an ended span drops what is set on it.
   */
  rendered(kind: 'cached' | 'fetched'): void {
    const stage: LoadStage = kind === 'cached' ? 'warm_render' : 'render';
    const now = performance.now();
    const ms = now - this.#startedAt;
    this.#recorded[`agent.session.load.${stage}_ms`] = Math.round(ms);
    const span = start('agent.session.render', this.#sessionId);
    try {
      span?.setAttr('agent.session.render.kind', kind);
      span?.setAttr('agent.session.render.since_load_ms', ms);
      span?.end();
      performance.measure(`agent.session.load.${stage}`, {
        start: this.#startedAt,
        end: now,
        detail: { sessionId: this.#sessionId, kind },
      });
      if (loadDebugEnabled()) {
        console.debug('[agent-session] render', this.#sessionId, {
          kind,
          since_load_ms: Math.round(ms),
        });
      }
    } catch {
      // See the module comment.
    }
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
      performance.measure('agent.session.load', {
        start: this.#startedAt,
        end: performance.now(),
        detail: { sessionId: this.#sessionId, outcome },
      });
      // A release is the expected end of an abandoned load, not a fault:
      // recording it as an error would bury the ones worth looking at.
      if (outcome === 'failed' && error !== undefined) this.#span?.error(error);
      this.#span?.end();
      if (loadDebugEnabled()) {
        console.debug('[agent-session] load', this.#sessionId, this.#recorded);
      }
    } catch {
      // See the module comment.
    }
  }

  #since(): number {
    return performance.now() - this.#startedAt;
  }

  #set(name: string, value: string | number | boolean): void {
    this.#recorded[name] =
      typeof value === 'number' ? Math.round(value) : value;
    try {
      this.#span?.setAttr(name, value);
    } catch {
      // See the module comment.
    }
  }
}

/**
 * A write of the cached log, after the load: its own short span and
 * measure, since the load span has usually ended by the time rows stream in.
 */
export function traceCacheWrite(
  sessionId: string,
  startedAt: number,
  rows: number
): void {
  const now = performance.now();
  const span = start('agent.session.cache.write', sessionId);
  try {
    span?.setAttr('agent.session.cache.write_ms', now - startedAt);
    span?.setAttr('agent.session.cache.rows', rows);
    span?.end();
    performance.measure('agent.session.cache.write', {
      start: startedAt,
      end: now,
      detail: { sessionId, rows },
    });
    if (loadDebugEnabled()) {
      console.debug('[agent-session] cache write', sessionId, {
        rows,
        ms: Math.round(now - startedAt),
      });
    }
  } catch {
    // See the module comment.
  }
}

function loadDebugEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(
      (window as { debugAgentSessionLoad?: boolean }).debugAgentSessionLoad
    )
  );
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
