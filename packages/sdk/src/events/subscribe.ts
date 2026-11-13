// The live event stream as an async iterator: the one transport `listen()`
// and `subscribe()` share. It owns reconnecting (with backoff and the
// stream's cursor as `Last-Event-ID`), the server's control events and
// dedupe by `event_id`; callers see only events and typed errors.

import { match } from 'ts-pattern';
import type {
  WebhookFilter,
  WebhookScope,
} from '../../generated/storage/types.gen';
import type { MacroClient } from '../utils/client';
import { MacroError } from '../utils/unwrap';
import type { MacroEvent } from './types';

/** Event ids remembered for dedupe across reconnects. */
const DEDUPE_WINDOW = 4_096;

/**
 * Events read ahead of the caller before the stream stops reading; the
 * server's own buffer then fills and it reports `lagged`, so a slow consumer
 * resumes from its cursor instead of growing this queue.
 */
const READ_AHEAD = 256;

/**
 * Short-lived revoked closes in a row, with no event delivered between them,
 * after which a refreshable listener gives up: its token source keeps handing
 * out tokens the server rejects within a minute or two.
 */
const MAX_REVOKED_RECONNECTS = 3;

/**
 * A connection open at least this long before it was revoked outlived two of
 * the server's 60 s credential re-checks: its token worked, and the revoke is
 * an ordinary expiry, not a refresh that hands out rejected tokens.
 */
const LONG_LIVED_MS = 120_000;

/** First reconnect delay; doubles per failed attempt up to the cap. */
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/**
 * The stream's cursor is older than the server's replay window (about an
 * hour): events were missed. Resync through the list APIs, then subscribe
 * again without a cursor.
 */
export class EventStreamResetError extends MacroError {
  constructor() {
    super(
      'event stream cursor expired: resync through the list APIs, then subscribe without a cursor',
    );
    this.name = 'EventStreamResetError';
  }
}

/**
 * The server revoked a listener's credential (it expired, was revoked, or its
 * bot was deleted) and the credential cannot refresh. Reported to
 * `listen({ onError })`; reconnect with a fresh credential.
 */
export class EventStreamRevokedError extends MacroError {
  /** Why: `credential` (expired or revoked) or `bot_deleted`. */
  readonly reason: string | undefined;

  constructor(reason?: string) {
    super(
      reason === 'bot_deleted'
        ? 'event stream closed: the listening bot was deleted'
        : 'event stream credential revoked: pass a token function that refreshes, or listen again with a fresh credential',
    );
    this.name = 'EventStreamRevokedError';
    this.reason = reason;
  }
}

/** Why a stream ended without an error. */
export type EventStreamCloseReason =
  /** The caller aborted, broke out of the loop or called `close()`. */
  | 'closed'
  /** The server revoked the stream's credential (or its bot was deleted). */
  | 'revoked';

/** A control event the server sends before it closes a stream. */
type ControlEvent =
  | { type: 'lagged'; cursor?: string | null }
  | { type: 'revoked'; reason?: string }
  | { type: 'reset' };

/** One parsed SSE frame of the event stream. */
type Frame =
  | { kind: 'event'; id?: string; event: MacroEvent & { event_id?: string } }
  | { kind: 'control'; control: ControlEvent };

/** How one connection ended. */
type ConnectionEnd =
  | { kind: 'reconnect'; immediate: boolean }
  | { kind: 'revoked'; reason?: string }
  | { kind: 'reset' }
  | { kind: 'fatal'; error: MacroError };

/** What the transport needs to open a stream. */
export interface StreamRequest {
  filters: WebhookFilter[];
  scope: WebhookScope;
  cursor?: string;
  signal?: AbortSignal;
  /** Reconnect without a cursor instead of throwing on `reset`. */
  resetToLive?: boolean;
  /**
   * Reconnect after `revoked` instead of ending, for a credential that can
   * refresh: every reconnect resolves the token source again.
   */
  reconnectOnRevoked?: boolean;
  /** Delay before reconnect attempt `n` (1-based). Tests shorten it. */
  backoff?: (attempt: number) => number;
}

function defaultBackoff(attempt: number): number {
  const capped = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return capped / 2 + Math.random() * (capped / 2);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function isControl(
  name: string | undefined,
  data: unknown,
): data is ControlEvent {
  return (
    (name === 'lagged' || name === 'revoked' || name === 'reset') &&
    typeof data === 'object' &&
    data !== null
  );
}

/**
 * Frames read from one connection, waiting for the consumer. The reader
 * pauses once `READ_AHEAD` frames wait, so a slow consumer pushes back on the
 * server instead of growing the queue.
 *
 * @mcp-exclude Internal to an event stream.
 */
class FrameQueue {
  /** How the connection ended, once it has. */
  ended: ConnectionEnd | undefined;

  private readonly frames: Frame[] = [];
  private wake: (() => void) | undefined;
  private resume: (() => void) | undefined;

  async push(frame: Frame): Promise<void> {
    this.frames.push(frame);
    this.wake?.();
    if (this.frames.length < READ_AHEAD) return;
    await new Promise<void>((resolve) => {
      this.resume = resolve;
    });
  }

  finish(end: ConnectionEnd): void {
    this.ended ??= end;
    this.wake?.();
  }

  /** The next frame, or undefined once the connection ended or aborted. */
  async next(signal: AbortSignal): Promise<Frame | undefined> {
    while (true) {
      const frame = this.frames.shift();
      if (this.frames.length < READ_AHEAD / 2) this.release();
      if (frame) return frame;
      if (this.ended || signal.aborted) return undefined;
      const woken = new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      const onAbort = () => this.wake?.();
      signal.addEventListener('abort', onAbort, { once: true });
      await woken;
      signal.removeEventListener('abort', onAbort);
      this.wake = undefined;
    }
  }

  /** Let a paused reader continue. */
  release(): void {
    this.resume?.();
    this.resume = undefined;
  }
}

/**
 * A live stream of events, read with `for await`. Each event's `event_type`
 * narrows its `metadata` and handles. `cursor` is the position of the last
 * event read: save it and pass it back as `subscribe({ cursor })` to resume
 * after a restart.
 *
 * @mcp-exclude A live event stream; MCP calls carry JSON only.
 */
export class EventStream<T> implements AsyncIterable<T> {
  /**
   * The position of the last delivered event, to resume from with
   * `subscribe({ cursor })`. Undefined until the first event. Without the
   * `public-event-stream` beta it is the last event id, which such servers
   * ignore on resume.
   */
  get cursor(): string | undefined {
    return this.position;
  }

  /** Why the stream ended, once it has ended without an error. */
  get closeReason(): EventStreamCloseReason | undefined {
    return this.closed;
  }

  /**
   * Why the server revoked the stream (`credential` or `bot_deleted`), when
   * it ended as `revoked`.
   */
  get revokeReason(): string | undefined {
    return this.revokedReason;
  }

  private revokedReason: string | undefined;
  private position: string | undefined;
  private closed: EventStreamCloseReason | undefined;
  private started = false;
  /** Servers older than `/events/stream` serve only the original path. */
  private useAlias = false;
  private readonly controller = new AbortController();
  private readonly seen = new Set<string>();
  private readonly backoff: (attempt: number) => number;
  private readonly onCallerAbort = () => this.controller.abort();

  /** @internal Obtain via `macro.events.subscribe()`. */
  constructor(
    private readonly client: MacroClient,
    private readonly request: StreamRequest,
    private readonly map: (event: MacroEvent) => T | undefined,
  ) {
    this.position = request.cursor;
    this.backoff = request.backoff ?? defaultBackoff;
    const signal = request.signal;
    if (signal?.aborted) this.controller.abort();
    signal?.addEventListener('abort', this.onCallerAbort, { once: true });
  }

  /** Stop the stream; a pending `next()` resolves as done. */
  close(): void {
    this.closed ??= 'closed';
    this.controller.abort();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.started) {
      throw new MacroError('an event stream can be iterated only once');
    }
    this.started = true;
    const generator = this.run();
    return {
      next: () => generator.next(),
      return: async (value?: unknown) => {
        this.close();
        await generator.return(undefined);
        return { done: true, value: value as T };
      },
      throw: (error?: unknown) => generator.throw(error),
    };
  }

  private async *run(): AsyncGenerator<T, void, undefined> {
    try {
      yield* this.loop();
    } finally {
      this.request.signal?.removeEventListener('abort', this.onCallerAbort);
    }
  }

  private async *loop(): AsyncGenerator<T, void, undefined> {
    const signal = this.controller.signal;
    const retry = { attempt: 0, idle: 0, revoked: 0 };
    while (!signal.aborted) {
      const { end, delivered, lastedMs } = yield* this.connection(signal);
      if (signal.aborted) break;
      // A connection that delivered, or stayed up past two credential
      // re-checks, was healthy: back off from scratch, and only short-lived
      // revoked closes count toward giving up.
      if (delivered || lastedMs >= LONG_LIVED_MS) {
        retry.attempt = 0;
        retry.revoked = 0;
      }
      if (!(await this.afterConnection(end, delivered, retry, signal))) return;
    }
    this.closed ??= 'closed';
  }

  /**
   * Decide what follows a connection: `false` ends the stream, `true`
   * reconnects (after a backoff when one is due). Throws a typed error for
   * `reset` and refused requests.
   */
  private async afterConnection(
    end: ConnectionEnd,
    delivered: boolean,
    retry: { attempt: number; idle: number; revoked: number },
    signal: AbortSignal,
  ): Promise<boolean> {
    if (end.kind === 'revoked') {
      retry.revoked += 1;
      // Only an expired credential can come back with a refreshed token (a
      // deleted bot cannot), and only while the refreshed tokens work.
      const refreshable =
        this.request.reconnectOnRevoked &&
        end.reason === 'credential' &&
        retry.revoked < MAX_REVOKED_RECONNECTS;
      if (!refreshable) {
        this.closed = 'revoked';
        this.revokedReason = end.reason;
        return false;
      }
      // Backed off, so a token source that keeps returning the expired
      // token does not reconnect in a tight loop.
      retry.attempt += 1;
      await sleep(this.backoff(retry.attempt), signal);
      return true;
    }
    if (end.kind === 'fatal') throw end.error;
    if (end.kind === 'reset') {
      this.position = undefined;
      if (this.request.resetToLive) return true;
      throw new EventStreamResetError();
    }
    if (end.immediate) {
      // A server that closes at once again and again is backed off too.
      retry.idle = delivered ? 0 : retry.idle + 1;
      if (retry.idle > 1) await sleep(this.backoff(retry.idle - 1), signal);
      return true;
    }
    retry.attempt += 1;
    await sleep(this.backoff(retry.attempt), signal);
    return true;
  }

  /** Read one connection to its end, yielding its new events. */
  private async *connection(
    signal: AbortSignal,
  ): AsyncGenerator<
    T,
    { end: ConnectionEnd; delivered: boolean; lastedMs: number },
    undefined
  > {
    const opened = Date.now();
    const queue = new FrameQueue();
    const connection = new AbortController();
    const stopConnection = () => connection.abort();
    signal.addEventListener('abort', stopConnection, { once: true });
    // Settles by calling `finish`; it never rejects.
    const connected = this.settle(
      connection.signal,
      (frame) => queue.push(frame),
      (end) => queue.finish(end),
    );
    let delivered = false;
    let end: ConnectionEnd | undefined;
    let closed = opened;
    try {
      for (
        let frame = await queue.next(signal);
        frame;
        frame = await queue.next(signal)
      ) {
        if (frame.kind === 'control') {
          end = this.onControl(frame.control);
          break;
        }
        delivered = true;
        const mapped = this.accept(frame);
        if (mapped !== undefined) yield mapped;
      }
      closed = Date.now();
    } finally {
      signal.removeEventListener('abort', stopConnection);
      connection.abort();
      queue.release();
      await connected;
    }
    return {
      end: end ?? queue.ended ?? { kind: 'reconnect', immediate: false },
      delivered,
      lastedMs: closed - opened,
    };
  }

  /** Advance the cursor past an event; its mapped form unless a duplicate. */
  private accept(frame: Extract<Frame, { kind: 'event' }>): T | undefined {
    if (frame.id !== undefined) this.position = frame.id;
    const id = frame.event.event_id;
    if (id !== undefined) {
      if (this.seen.has(id)) return undefined;
      this.remember(id);
    }
    return this.map(frame.event);
  }

  private onControl(control: ControlEvent): ConnectionEnd {
    return match(control)
      .returnType<ConnectionEnd>()
      .with({ type: 'lagged' }, ({ cursor }) => {
        if (cursor) this.position = cursor;
        return { kind: 'reconnect', immediate: true };
      })
      .with({ type: 'revoked' }, ({ reason }) => ({ kind: 'revoked', reason }))
      .with({ type: 'reset' }, () => ({ kind: 'reset' }))
      .exhaustive((unknown) => {
        console.warn('macro sdk: unknown stream control event', unknown);
        return { kind: 'reconnect', immediate: true };
      });
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size > DEDUPE_WINDOW) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }

  /** Run one connection and report how it ended, failures included. */
  private async settle(
    signal: AbortSignal,
    push: (frame: Frame) => Promise<void>,
    finish: (end: ConnectionEnd) => void,
  ): Promise<void> {
    try {
      finish(await this.connect(signal, push));
    } catch (error) {
      finish({
        kind: 'fatal',
        error:
          error instanceof MacroError
            ? error
            : new MacroError(`event stream failed: ${String(error)}`),
      });
    }
  }

  /** Hold one connection open, pushing its frames, until it ends. */
  private async connect(
    signal: AbortSignal,
    push: (frame: Frame) => Promise<void>,
  ): Promise<ConnectionEnd> {
    let status: number | undefined;
    let failure: unknown;
    let pending: { event?: string; id?: string } = {};
    const cursor = this.position;
    const options = {
      query: {
        scope: this.request.scope,
        filters: JSON.stringify(this.request.filters),
        ...(cursor ? { cursor } : {}),
      },
      headers: cursor ? { 'Last-Event-ID': cursor } : undefined,
      signal,
      sseMaxRetryAttempts: 1,
      fetch: Object.assign(
        async (request: Request) => {
          const response = await globalThis.fetch(request);
          status = response.status;
          return response;
        },
        { preconnect: globalThis.fetch.preconnect },
      ) as typeof fetch,
      onSseEvent: (event: { event?: string; id?: string }) => {
        pending = { event: event.event, id: event.id };
      },
      onSseError: (error: unknown) => {
        failure = error;
      },
    };

    const { stream } = this.useAlias
      ? await this.client.storage.streamEventsAlias(options)
      : await this.client.storage.streamEvents(options);
    for await (const data of stream as AsyncIterable<unknown>) {
      const { event: name, id } = pending;
      if (isControl(name, data)) {
        await push({ kind: 'control', control: data });
        return { kind: 'reconnect', immediate: true };
      }
      if (typeof data === 'object' && data !== null && 'event_type' in data) {
        await push({ kind: 'event', id, event: data as Frame & MacroEvent });
      }
    }

    if (signal.aborted) return { kind: 'reconnect', immediate: true };
    if (status === 410) return { kind: 'reset' };
    if (status === 404 && !this.useAlias) {
      this.useAlias = true;
      return { kind: 'reconnect', immediate: true };
    }
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      return {
        kind: 'fatal',
        error: new MacroError(
          `event stream refused (${status}): ${failure instanceof Error ? failure.message : 'request failed'}`,
        ),
      };
    }
    // Network errors, 429, 5xx, and a server closing a healthy stream (a
    // deploy) all resume from the cursor after a backoff.
    return { kind: 'reconnect', immediate: false };
  }
}
