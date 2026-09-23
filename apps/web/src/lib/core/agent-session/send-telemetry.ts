/**
 * Telemetry for one send: the click, the create and first prompt leaving,
 * the user bubble appearing, and the first agent tokens landing.
 *
 * The backend traces a session thoroughly once a request reaches it. What it
 * cannot see is the half a person actually experiences — a send that never
 * created a session, a first prompt that never left, a transcript that never
 * showed the reply. That gap is what this fills: one span per send, always
 * ended, always carrying the outcome, never the prompt text.
 *
 * Failures here are swallowed. Telemetry that can break a send is worse
 * than no telemetry.
 */

import type { Span } from '@macro-inc/observability';
import { Telemetry } from '@macro-inc/observability';
import type {
  FoldedMessage,
  FoldedStreamEvent,
} from '@service-agent-fold/generated/types';

/** How a send ended. */
export type SendOutcome =
  /** The first agent message of this send's turn reached the transcript. */
  | 'responded'
  /** Create, the first prompt, or the follow-up issue failed. */
  | 'failed'
  /** A newer send on the same session replaced this one. */
  | 'superseded'
  /** Still unsettled at {@link SEND_STALL_THRESHOLD_MS} — reported, not concluded. */
  | 'stalled';

/** Which composer started the send. */
export type SendSurface = 'new_chat' | 'session';

export type StartSend = {
  surface: SendSurface;
  /** Prompt length only — never the text. */
  promptChars: number;
  attachmentCount: number;
};

/**
 * How long a send may go unsettled before it is reported as stalled.
 *
 * Creating a managed session waits on a sandbox boot — minutes, not
 * milliseconds — and the first agent token comes after that. A span
 * reaches the exporter only when it ends, so a send that never settles
 * would otherwise produce no telemetry at all. Well past a healthy
 * create-plus-first-token, so a slow session is never a stuck one.
 */
export const SEND_STALL_THRESHOLD_MS = 600_000;

const traces = new Map<string, AgentSendTrace>();

/**
 * One send, from the composer click to the first visible agent reply.
 *
 * Held rather than run around an operation because the wait it measures
 * continues after the click: the create is in flight, the pane mounts,
 * the load folds, and websocket frames arrive on another stack.
 */
export class AgentSendTrace {
  readonly #span: Span | undefined;
  readonly #startedAt = performance.now();
  #key: string;
  #ended = false;
  #turn: number | undefined;
  #stallTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(key: string, start: StartSend) {
    this.#key = key;
    this.#span = begin(start, key);
    this.#stallTimer = setTimeout(
      () => this.end('stalled'),
      SEND_STALL_THRESHOLD_MS
    );
  }

  /**
   * Re-key the send onto the real session id once create lands. Later
   * load and fold observations look the send up by that id.
   */
  adopt(sessionId: string): void {
    if (this.#ended || sessionId === this.#key) return;
    if (traces.get(this.#key) === this) traces.delete(this.#key);
    this.#key = sessionId;
    traces.set(sessionId, this);
    this.#set('agent.session.id', sessionId);
  }

  /** The create POST answered with a session. */
  created(): void {
    this.#set('agent.send.create_ms', this.#since());
    this.#event('session.created');
  }

  /** The first prompt (or follow-up) was accepted under `actionId`. */
  prompted(actionId: string): void {
    this.#set('agent.action.id', actionId);
    this.#set('agent.send.prompt_ms', this.#since());
    this.#event('prompt.accepted');
  }

  /**
   * Fold events just landed. The first user prompt on this send claims the
   * turn; the first agent message of that turn ends the send as responded.
   */
  observe(events: readonly FoldedStreamEvent[]): void {
    if (this.#ended) return;
    for (const message of messagesOf(events)) {
      if (this.#turn === undefined && isUserPrompt(message)) {
        this.#turn = message.turn;
        this.#set('agent.send.turn', message.turn);
        this.#set('agent.send.user_message_ms', this.#since());
        this.#event('user_message.visible');
      }
      if (
        this.#turn !== undefined &&
        message.author.kind === 'agent' &&
        message.turn === this.#turn
      ) {
        this.#set('agent.send.agent_message_ms', this.#since());
        this.#event('agent_message.visible');
        this.end('responded');
        return;
      }
    }
  }

  /** Run with this send as the active OpenTelemetry context. */
  run<T>(operation: () => T): T {
    return this.#span?.run(operation) ?? operation();
  }

  /** Start a child of this send, or nothing if the send never opened. */
  span(name: string): Span | undefined {
    try {
      return this.#span?.span(name);
    } catch {
      return undefined;
    }
  }

  /**
   * End the span with how the send turned out. Safe to call more than
   * once; the first outcome is the one recorded.
   */
  end(outcome: SendOutcome, error?: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    clearTimeout(this.#stallTimer);
    this.#stallTimer = undefined;
    if (traces.get(this.#key) === this) traces.delete(this.#key);
    this.#set('agent.send.outcome', outcome);
    this.#set('agent.send.total_ms', this.#since());
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

  #set(name: string, value: string | number): void {
    try {
      this.#span?.setAttr(name, value);
    } catch {
      // See the module comment.
    }
  }

  #event(name: string): void {
    try {
      this.#span?.event(name);
    } catch {
      // See the module comment.
    }
  }
}

/**
 * Start a send against `key` — a placeholder for a new conversation, or
 * the session id for a follow-up. A send already open on that key is
 * ended as superseded.
 */
export function startSend(key: string, start: StartSend): AgentSendTrace {
  traces.get(key)?.end('superseded');
  const trace = new AgentSendTrace(key, start);
  traces.set(key, trace);
  return trace;
}

/** The open send for `key`, if one has not already ended. */
export function sendTraceFor(key: string): AgentSendTrace | undefined {
  return traces.get(key);
}

/** Fold events just landed for `sessionId`; record message visibility. */
export function observeSend(
  sessionId: string,
  events: readonly FoldedStreamEvent[]
): void {
  traces.get(sessionId)?.observe(events);
}

/** Drop open sends between tests. */
export function resetSendTraces(): void {
  for (const trace of traces.values()) trace.end('superseded');
  traces.clear();
}

function begin(start: StartSend, key: string): Span | undefined {
  try {
    const span = Telemetry.span('agent.send');
    span.setAttr('agent.send.surface', start.surface);
    span.setAttr('agent.send.prompt_chars', start.promptChars);
    span.setAttr('agent.send.attachment_count', start.attachmentCount);
    if (start.surface === 'session') span.setAttr('agent.session.id', key);
    return span;
  } catch {
    return undefined;
  }
}

function messagesOf(events: readonly FoldedStreamEvent[]): FoldedMessage[] {
  const messages: FoldedMessage[] = [];
  for (const event of events) {
    if (event.kind === 'new' || event.kind === 'update') {
      messages.push(event.message);
    } else if (event.kind === 'replace') {
      messages.push(...event.messages);
    }
  }
  return messages;
}

/** A person prompt, not a model-change or stop control. */
function isUserPrompt(message: FoldedMessage): boolean {
  return (
    message.author.kind === 'user' &&
    message.parts.some((part) => part.kind !== 'control')
  );
}
