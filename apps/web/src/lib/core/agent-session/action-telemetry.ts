/**
 * Telemetry for acting on a session: what a person waited for after pressing
 * send or stop, and what ended the wait.
 *
 * The control POST is already traced end to end — `safeFetch` opens a client
 * span and injects the `traceparent` the services adopt, so everything the
 * harness does hangs off the browser's request. But the POST returning is
 * not what the person is waiting for, and the backend trace ends when the
 * request does:
 *
 * A stop does not end a turn. It sends `session/cancel`, and the runtime
 * answers when it has unwound — in production that has taken seventeen
 * seconds while the composer looked idle. That wait is what this measures:
 * one span per issued action, and for a stop it stays open until the fold
 * says the turn is over.
 *
 * The other deferred wait, a prompt queued behind a running turn, is timed
 * where it is exact: the harness knows when the entry was admitted and when
 * it dispatched, and records `agent.queue.wait_ms` on the dispatch. Holding
 * a browser span open for it would measure the same thing worse.
 *
 * Failures are swallowed: telemetry that can break sending a message is
 * worse than no telemetry (same rule as {@link ./load-telemetry}).
 */

import type { Span } from '@macro-inc/observability';
import type { TurnState } from '@service-agent-fold/generated/types';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import { startSessionSpan } from './session-span';

/** How an issued action stopped being something the person waits on. */
export type ActionOutcome =
  /** It reached the runtime as it was posted; nothing was waited for. */
  | 'sent'
  /** The server queued it behind the running turn; the harness times the
   *  rest of that wait. */
  | 'queued'
  /** A stop: the turn it cancelled is over. */
  | 'settled'
  /** The POST was refused, or never answered. */
  | 'failed'
  /** Another stop was accepted before this one's turn ended. */
  | 'superseded'
  /** The session was let go while a stop was still outstanding. */
  | 'abandoned'
  /** Still outstanding after {@link STALL_THRESHOLD_MS} — reported, not
   *  concluded. */
  | 'stalled';

/**
 * How long a stop may go unsettled before it is reported as stalled.
 *
 * Only a stop waits at all here, and a stop resolves when the turn ends, so
 * this never delays a normal report — the span ends the moment the fold
 * settles it, usually inside a second. It exists for the one case that would
 * otherwise produce no telemetry whatsoever: a span reaches the exporter only
 * when it ends, so a stop nothing ever answers would be silent, which is
 * precisely the failure worth seeing.
 */
const STALL_THRESHOLD_MS = 60_000;

/**
 * One action issued against a session, from the press to whatever ended the
 * wait it opened.
 *
 * Held rather than run around an operation: what ends it usually arrives on
 * the fold, long after the POST it started with resolved.
 */
export class ActionTrace {
  readonly #span: Span | undefined;
  readonly #startedAt = performance.now();
  #ended = false;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;

  /** `turn` is where the session stood when the action was issued — which is
   *  what decides whether the server will queue it. */
  constructor(sessionId: string, action: AgentAction, turn: TurnState) {
    this.#span = startSessionSpan('agent.session.action', sessionId);
    this.#set('agent.action.type', action.type);
    this.#set('agent.action.issued_turn', turn);
    this.#stallTimer = setTimeout(
      () => this.end('stalled'),
      STALL_THRESHOLD_MS
    );
  }

  /** The harness answered: this is the id it accepted the action under. */
  accepted(actionId: string): void {
    this.#set('agent.action.id', actionId);
    this.#set('agent.action.post_ms', this.#since());
  }

  /**
   * End the span with how the wait turned out. Safe to call more than once;
   * the first outcome is the one recorded, so a release racing a dispatch
   * does not rewrite it.
   */
  end(outcome: ActionOutcome, error?: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    clearTimeout(this.#stallTimer);
    this.#stallTimer = undefined;
    this.#set('agent.action.outcome', outcome);
    this.#set('agent.action.total_ms', this.#since());
    try {
      if (outcome === 'failed' && error !== undefined) this.#span?.error(error);
      this.#span?.end();
    } catch {
      // See the module comment.
    }
  }

  #since(): number {
    return performance.now() - this.#startedAt;
  }

  #set(name: string, value: string | number | boolean): void {
    try {
      this.#span?.setAttr(name, value);
    } catch {
      // See the module comment.
    }
  }
}
