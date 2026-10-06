/**
 * Telemetry for sending a prompt: from the moment a person sends it to the
 * agent's first text on screen, as one span.
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
import { observeRenderedAnswer } from './render-telemetry';

/** How a sent prompt ended, as far as this span is concerned. */
export type PromptOutcome =
  /** The agent's first text for the prompt's turn was painted. */
  | 'text'
  /** The turn ended after reasoning or tool calls, without any text. */
  | 'no_text'
  /** The turn ended before the agent produced anything. */
  | 'no_output'
  /** The prompt was never accepted: the create, a setting, or the POST failed. */
  | 'failed'
  /** Every holder released the session before any output arrived. */
  | 'released'
  /** The document was hidden before a readable answer could paint. */
  | 'hidden'
  /** Raw text arrived but no visible renderer confirmed it before the deadline. */
  | 'not_rendered'
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
  | 'first_output'
  /** The turn's first agent text was folded. */
  | 'first_text'
  /** A renderer for the matching answer mounted. */
  | 'text_mounted'
  /** Readable answer text was present in visible transcript DOM. */
  | 'first_text_rendered'
  /** That visible DOM remained readable across a paint boundary. */
  | 'first_text_paint';

/**
 * When a batch of stored frames reached this browser, and how long after the
 * server stored the newest of them. The lag compares the server's clock with
 * this one, so it carries their skew: read it as a distribution.
 */
export type FrameDelivery = {
  /**
   * How the batch came: pushed over the realtime socket, or read back by a
   * snapshot refetch after the socket missed it.
   */
  via: 'socket' | 'snapshot';
  /** `performance.now()` when the batch arrived, before it was folded. */
  receivedAt: number;
  /** Milliseconds from the server storing the batch's newest frame. */
  lagMs: number;
};

/** The delivery of a batch of stored rows, if it carries any. */
export function frameDelivery(
  via: FrameDelivery['via'],
  rows: { createdAt: string }[]
): FrameDelivery | undefined {
  const storedAt = Math.max(...rows.map((row) => Date.parse(row.createdAt)));
  if (!Number.isFinite(storedAt)) return undefined;
  return { via, receivedAt: performance.now(), lagMs: Date.now() - storedAt };
}

/**
 * How long a prompt may wait for output before it is reported as stalled.
 * Long because a cold sandbox boot can take minutes, and a span only
 * exports once it ends.
 */
const STALL_THRESHOLD_MS = 5 * 60_000;
const RENDER_TIMEOUT_MS = 10_000;

type Attributes = Record<string, string | number | boolean>;

/** Bounded UI origins supplied by the composer that submits the prompt. */
export type PromptSubmitSurface =
  | 'home'
  | 'agents'
  | 'mobile_composer'
  | 'search'
  | 'document'
  | 'drive'
  | 'agent_session'
  | 'other';

type PromptTraceOptions = {
  newSession: boolean;
  submitSurface?: PromptSubmitSurface;
};

export class PromptTrace {
  readonly #span: Span | undefined;
  readonly #sessionId: string;
  readonly #startedAt = performance.now();
  /** Ids the prompt may be confirmed under: the speculated one and the accepted one. */
  readonly #actionIds = new Set<string>();
  /** The prompt's turn, once the log confirmed it. */
  #turn: number | undefined;
  #output = false;
  #text = false;
  #ended = false;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;
  #renderTimer: ReturnType<typeof setTimeout> | undefined;
  #mounted = false;
  #rendered = false;
  readonly #renderers = new Set<() => void>();

  constructor(sessionId: string, options: PromptTraceOptions) {
    this.#sessionId = sessionId;
    this.#span = start(sessionId, options);
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
    const now = performance.now();
    const atMs = Math.round(now - this.#startedAt);
    this.#set(`agent.prompt.${stage}_at_ms`, atMs);
    for (const [name, value] of Object.entries(attributes)) {
      this.#set(`agent.prompt.${name}`, value);
    }
    try {
      this.#span?.event(`agent.prompt.${stage}`, {
        at_ms: atMs,
        ...attributes,
      });
      performance.measure(`agent.prompt.${stage}`, {
        start: this.#startedAt,
        end: now,
        detail: { sessionId: this.#sessionId },
      });
    } catch {
      // See the module comment.
    }
  }

  /** Called by the matching TextPart, never by raw fold delivery. */
  observeRenderedText(
    turn: number,
    element: HTMLElement
  ): (() => void) | undefined {
    if (this.#ended || this.#turn !== turn) return;
    try {
      if (!this.#mounted) {
        this.#mounted = true;
        this.stage('text_mounted');
      }
      const stop = observeRenderedAnswer(element, {
        readable: () => {
          if (this.#rendered) return;
          this.#rendered = true;
          this.stage('first_text_rendered');
        },
        painted: () => {
          this.stage('first_text_paint');
          this.end('text');
        },
        hidden: () => {
          if (this.#text) this.end('hidden');
        },
      });
      if (this.#ended) {
        stop();
        return;
      }
      this.#renderers.add(stop);
      return () => {
        stop();
        this.#renderers.delete(stop);
      };
    } catch {
      // Rendering the answer must never depend on telemetry support.
      return;
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

  /**
   * Read fold events for the prompt's confirmation and its turn's first
   * output and text. `delivery` is how the frames they came from arrived.
   */
  observe(events: FoldedStreamEvent[], delivery?: FrameDelivery): void {
    if (this.#ended) return;
    try {
      for (const event of events) {
        for (const message of messagesOf(event)) {
          this.#observeMessage(message, delivery);
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
    clearTimeout(this.#renderTimer);
    this.#renderTimer = undefined;
    this.#set('agent.prompt.renderer_mounted', this.#mounted);
    this.#set('agent.prompt.renderer_attached', this.#renderers.size > 0);
    for (const stop of this.#renderers) stop();
    this.#renderers.clear();
    if (outcome === 'hidden') this.#set('agent.prompt.hidden', true);
    this.#set('agent.prompt.outcome', outcome);
    this.#set(
      'agent.prompt.total_ms',
      Math.round(performance.now() - this.#startedAt)
    );
    this.#ended = true;
    try {
      if (outcome === 'failed' && error !== undefined) this.#span?.error(error);
      this.#span?.end();
      performance.measure('agent.prompt', {
        start: this.#startedAt,
        end: performance.now(),
        detail: { sessionId: this.#sessionId, outcome },
      });
    } catch {
      // See the module comment.
    }
  }

  #observeMessage(message: FoldedMessage, delivery?: FrameDelivery): void {
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
    if (message.author.kind === 'agent') this.#observeAgent(message, delivery);
    if (message.stop && !this.#text) {
      this.#set('agent.prompt.stop', message.stop.kind);
      this.end(this.#output ? 'no_text' : 'no_output');
    }
  }

  #observeAgent(message: FoldedMessage, delivery?: FrameDelivery): void {
    if (!this.#output) {
      this.#output = true;
      this.stage('first_output', {
        first_output_part: message.parts[0]?.kind ?? 'none',
      });
    }
    const text = message.parts.some(
      (part) => part.kind === 'text' && part.text.trim() !== ''
    );
    if (this.#text || !text) return;
    this.#text = true;
    this.stage(
      'first_text',
      delivery && {
        first_text_via: delivery.via,
        first_text_delivery_ms: delivery.lagMs,
        first_text_fold_ms: Math.round(performance.now() - delivery.receivedAt),
      }
    );
    // A hidden tab never paints, and never runs animation frames either.
    if (documentHidden()) {
      this.#set('agent.prompt.hidden', true);
      this.end('hidden');
      return;
    }
    this.#renderTimer = setTimeout(
      () => this.end('not_rendered'),
      RENDER_TIMEOUT_MS
    );
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

function documentHidden(): boolean {
  return (
    typeof document === 'undefined' ||
    typeof requestAnimationFrame === 'undefined' ||
    document.visibilityState === 'hidden'
  );
}

function messagesOf(event: FoldedStreamEvent): FoldedMessage[] {
  return match(event)
    .with({ kind: 'new' }, { kind: 'update' }, (changed) => [changed.message])
    .with({ kind: 'replace' }, (replaced) => replaced.messages)
    .with({ kind: 'metadata' }, () => [])
    .exhaustive();
}

function start(
  sessionId: string,
  options: PromptTraceOptions
): Span | undefined {
  try {
    const span = Telemetry.span('agent.prompt');
    span.setAttr('agent.session.id', sessionId);
    span.setAttr('agent.prompt.new_session', options.newSession);
    span.setAttr(
      'agent.prompt.submit_surface',
      options.submitSurface ?? submitSurface(options.newSession)
    );
    return span;
  } catch {
    return undefined;
  }
}

/** Bounded route categories only; paths and entity IDs are never telemetry labels. */
function submitSurface(newSession: boolean): PromptSubmitSurface {
  if (!newSession) return 'agent_session';
  const route = typeof location === 'undefined' ? '' : location.pathname;
  // Layout URLs enumerate panes without identifying the active one. Known
  // composers supply their origin explicitly; never guess the leftmost pane.
  if (route.includes('/~/')) return 'other';
  if (/^\/app\/drive(?:\/|$)/.test(route)) {
    return /\/(?:md|task|skill|snippet|canvas|pdf|code|csv|image|video|spreadsheet|unknown)\/[^/]+\/?$/.test(
      route
    )
      ? 'document'
      : 'drive';
  }
  if (/^\/app\/?$/.test(route) || /^\/app\/home(?:\/|$)/.test(route))
    return 'home';
  if (/^\/app\/agents(?:\/|$)/.test(route)) return 'agents';
  if (/^\/app\/search(?:\/|$)/.test(route)) return 'search';
  if (/^\/app\/(?:md|pdf|code|document)\//.test(route)) return 'document';
  return 'other';
}
