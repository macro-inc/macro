/**
 * Telemetry for sending a prompt: from the moment a person sends it to the
 * first agent output on screen, as one span.
 *
 * Without it the flow is several unrelated traces (the create, the load, a
 * config control, the prompt control, the server's turn) and the waits in the
 * browser between them are invisible. Every harness request made inside
 * {@link PromptTrace.run} carries this span's traceparent, so the server's
 * turn nests under it.
 *
 * Failures here are swallowed. Telemetry that can break sending a prompt is
 * worse than no telemetry.
 */

import type { Span } from '@macro-inc/observability';
import { Telemetry } from '@macro-inc/observability';
import type {
  FoldedMessage,
  FoldedStreamEvent,
} from '@service-agent-fold/generated/types';
import { match } from 'ts-pattern';

/** How a sent prompt ended, as far as this span is concerned. */
export type PromptOutcome =
  /** The agent produced its first output for the prompt's turn. */
  | 'output'
  /** The turn ended before the agent produced anything. */
  | 'no_output'
  /** The prompt was never accepted: the create, a setting, or the POST failed. */
  | 'failed'
  /** Every holder released the session before any output arrived. */
  | 'released'
  /** Still waiting at {@link STALL_THRESHOLD_MS} — reported, not concluded. */
  | 'stalled';

/** A point the prompt reached, named as its attribute and event suffix. */
export type PromptStage =
  /** A new session's create answered. */
  | 'created'
  /** A new session's log was loaded. */
  | 'loaded'
  /** A new session's model and effort were confirmed. */
  | 'configured'
  /** The control POST answered. */
  | 'accepted'
  /** The log confirmed the prompt: its row came back over the socket. */
  | 'confirmed'
  /** The first agent message in the prompt's turn was folded. */
  | 'first_output';

/**
 * How long a prompt may wait for output before it is reported as stalled.
 * Long because a cold sandbox boot can take minutes, and a span only
 * exports once it ends.
 */
const STALL_THRESHOLD_MS = 5 * 60_000;

type Attributes = Record<string, string | number | boolean>;

export class PromptTrace {
  readonly #span: Span | undefined;
  readonly #startedAt = performance.now();
  /** Ids the prompt may be confirmed under: the speculated one and the accepted one. */
  readonly #actionIds = new Set<string>();
  /** The prompt's turn, once the log confirmed it. */
  #turn: number | undefined;
  #ended = false;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(sessionId: string, options: { newSession: boolean }) {
    this.#span = start(sessionId, options.newSession);
    this.#stallTimer = setTimeout(
      () => this.end('stalled'),
      STALL_THRESHOLD_MS
    );
  }

  get ended(): boolean {
    return this.#ended;
  }

  /** Run `operation` with this span active, so its requests join the trace. */
  run<T>(operation: () => T): T {
    if (!this.#span) return operation();
    let ran = false;
    try {
      return this.#span.run(() => {
        ran = true;
        return operation();
      });
    } catch (error) {
      if (ran) throw error;
      return operation();
    }
  }

  stage(stage: PromptStage, attributes: Attributes = {}): void {
    if (this.#ended) return;
    const atMs = Math.round(performance.now() - this.#startedAt);
    this.#set(`agent.prompt.${stage}_at_ms`, atMs);
    for (const [name, value] of Object.entries(attributes)) {
      this.#set(`agent.prompt.${name}`, value);
    }
    try {
      this.#span?.event(`agent.prompt.${stage}`, {
        at_ms: atMs,
        ...attributes,
      });
    } catch {
      // See the module comment.
    }
  }

  /** The control will be sent under `actionId`; its confirmation may name it. */
  expect(actionId: string): void {
    this.#actionIds.add(actionId);
  }

  /** The control POST answered with the id the harness accepted it under. */
  accepted(actionId: string, queued: boolean): void {
    this.#actionIds.add(actionId);
    this.#set('agent.prompt.action_id', actionId);
    if (queued) this.#set('agent.prompt.queued', true);
    this.stage('accepted');
  }

  /** Read fold events for the prompt's confirmation and its turn's first output. */
  observe(events: FoldedStreamEvent[]): void {
    if (this.#ended) return;
    try {
      for (const event of events) {
        for (const message of messagesOf(event)) {
          this.#observeMessage(message);
          if (this.#ended) return;
        }
      }
    } catch {
      // See the module comment.
    }
  }

  /** End the span. Safe to call more than once; the first outcome stands. */
  end(outcome: PromptOutcome, error?: unknown): void {
    if (this.#ended) return;
    clearTimeout(this.#stallTimer);
    this.#stallTimer = undefined;
    this.#set('agent.prompt.outcome', outcome);
    this.#set(
      'agent.prompt.total_ms',
      Math.round(performance.now() - this.#startedAt)
    );
    this.#ended = true;
    try {
      if (outcome === 'failed' && error !== undefined) this.#span?.error(error);
      this.#span?.end();
    } catch {
      // See the module comment.
    }
  }

  #observeMessage(message: FoldedMessage): void {
    if (
      this.#turn === undefined &&
      message.author.kind === 'user' &&
      !message.pending &&
      message.requestId !== null &&
      this.#actionIds.has(message.requestId)
    ) {
      this.#turn = message.turn;
      this.stage('confirmed', { turn: message.turn });
    }
    if (this.#turn === undefined || message.turn !== this.#turn) return;
    if (message.author.kind === 'agent') {
      this.stage('first_output', {
        first_output_part: message.parts[0]?.kind ?? 'none',
      });
      this.end('output');
      return;
    }
    if (message.stop) {
      this.#set('agent.prompt.stop', message.stop.kind);
      this.end('no_output');
    }
  }

  #set(name: string, value: string | number | boolean): void {
    if (this.#ended) return;
    try {
      this.#span?.setAttr(name, value);
    } catch {
      // See the module comment.
    }
  }
}

function messagesOf(event: FoldedStreamEvent): FoldedMessage[] {
  return match(event)
    .with({ kind: 'new' }, { kind: 'update' }, (changed) => [changed.message])
    .with({ kind: 'replace' }, (replaced) => replaced.messages)
    .with({ kind: 'metadata' }, () => [])
    .exhaustive();
}

function start(sessionId: string, newSession: boolean): Span | undefined {
  try {
    const span = Telemetry.span('agent.prompt');
    span.setAttr('agent.session.id', sessionId);
    span.setAttr('agent.prompt.new_session', newSession);
    return span;
  } catch {
    return undefined;
  }
}
