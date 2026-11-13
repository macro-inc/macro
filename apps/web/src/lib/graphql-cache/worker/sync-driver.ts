/**
 * Streamed cache sync in the engine worker: opens the stream with `fetch`,
 * feeds the response bytes to the WASM engine, and applies each decoded frame
 * as its own queued engine task. The main thread never sees the data.
 * While the engine writes, the body keeps being read into a bounded buffer
 * (`SYNC_READ_AHEAD_BYTES`), so the server prepares later pages meanwhile.
 * Contract: `../sync-protocol.ts` and docs/architecture/streamed-cache-sync.md.
 */

import { match } from 'ts-pattern';
import type { WriteResult } from '../protocol';
import type {
  SyncFailure,
  SyncLaneState,
  SyncRunOutcome,
  SyncRunResult,
  SyncStartArgs,
} from '../sync-protocol';

/** One applied frame, as the WASM engine reports it for fan-out. */
export type SyncAppliedWire =
  | { kind: 'idle' }
  | { kind: 'recorded' }
  | { kind: 'hydrated'; lane: string; write: WriteResult }
  | {
      kind: 'deleted';
      lane: string;
      revision: string;
      changed: string[];
      affectedOps: string[];
    }
  | { kind: 'calendar'; lane: string; write: WriteResult };

type SyncFinishWire =
  | { ok: true; result: SyncRunResult }
  | { ok: false; message: string; partial: SyncRunResult };

/** The WASM engine's sync surface. */
export interface SyncEngine {
  syncBegin(argsJson: string): Promise<string>;
  syncFeed(bytes: Uint8Array): Promise<number>;
  syncApplyNext(): Promise<SyncAppliedWire>;
  syncFinish(): Promise<SyncFinishWire>;
  syncAbort(): Promise<SyncRunResult | null>;
  syncState(): Promise<SyncLaneState[]>;
}

export interface SyncDriverOptions {
  /**
   * Runs `task` on the engine through the worker's request queue at
   * background-hydration priority, so foreground reads go first.
   */
  runTask<T>(task: (engine: SyncEngine) => Promise<T>): Promise<T>;
  /** Publishes one applied frame like the matching ordinary request. */
  publish(applied: SyncAppliedWire): void;
  /** Reports an engine failure (for reset-required latching). */
  reportEngineError(error: unknown): void;
  fetch?: typeof fetch;
  /** Received but unapplied bytes a run may hold (`SYNC_READ_AHEAD_BYTES`). */
  readAheadBytes?: number;
  /** How long a run waits for the response or its next bytes (`SYNC_STALL_MS`). */
  stallMs?: number;
  /**
   * Resolves on a later event-loop task. Engine tasks chain through
   * microtasks, so without it a run with buffered bytes would never let body
   * reads or foreground requests (port messages) in between frames.
   */
  nextTask?: () => Promise<void>;
  /** How often hydrated pages publish (`SYNC_PUBLISH_INTERVAL_MS`). */
  publishIntervalMs?: number;
  /** Monotonic clock for publication coalescing. */
  now?: () => number;
}

/**
 * Hydrated pages publish at most this often: they only tell cache-only
 * consumers that a newer revision exists, so faster pages need not wake them
 * more often. Every other frame publishes at once, after the pages before it.
 * Same value as the native plugin's `PUBLISH_INTERVAL`.
 */
export const SYNC_PUBLISH_INTERVAL_MS = 250;

type HydratedWire = Extract<SyncAppliedWire, { kind: 'hydrated' }>;

/** A later hydrated page's publication, carrying what both changed. */
function mergeHydrated(
  earlier: HydratedWire,
  later: HydratedWire
): HydratedWire {
  const { searchChangedBuckets: laterBuckets, ...write } = later.write;
  const earlierBuckets = earlier.write.searchChangedBuckets;
  // An unknown bucket set stays unknown (consumers refresh conservatively).
  const buckets =
    earlierBuckets && laterBuckets
      ? [...new Set([...earlierBuckets, ...laterBuckets])]
      : undefined;
  return {
    ...later,
    write: {
      ...write,
      revisionAdvanced:
        earlier.write.revisionAdvanced || later.write.revisionAdvanced,
      ...(buckets ? { searchChangedBuckets: buckets } : {}),
    },
  };
}

/** Merges hydrated pages into one publication per interval. */
class CoalescedPublisher {
  private pending: HydratedWire | undefined;
  private last: number | undefined;

  constructor(
    private readonly publish: (applied: SyncAppliedWire) => void,
    private readonly intervalMs: number,
    private readonly now: () => number
  ) {}

  push(applied: SyncAppliedWire): void {
    if (applied.kind !== 'hydrated' || applied.write.reset) {
      this.flush();
      this.publish(applied);
      return;
    }
    this.pending = this.pending
      ? mergeHydrated(this.pending, applied)
      : applied;
    if (this.last === undefined || this.now() - this.last >= this.intervalMs) {
      this.flush();
    }
  }

  /** Publishes what is pending; every exit of a run calls this. */
  flush(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    this.last = this.now();
    this.publish(pending);
  }
}

/**
 * Response bytes read ahead of the cache: received but not yet applied.
 * 16 MiB holds about 15 first-pass pages (≈1 MB each at most), enough for the
 * server to keep computing pages while one is written, with memory bounded at
 * this cap plus one body chunk. Same value as the native plugin's
 * `READ_AHEAD_BYTES`.
 */
export const SYNC_READ_AHEAD_BYTES = 16 * 1024 * 1024;

/**
 * How long a run waits for the response, or for the next bytes of its body,
 * before it gives the connection up as stalled. A connection that went silent
 * (a dropped network path) never fails by itself. A healthy stream is silent
 * for at most the server's page limit (45 s) plus one `waiting` interval
 * (10 s). Same value as the native plugin's `STALL_TIMEOUT`.
 */
export const SYNC_STALL_MS = 90_000;

/** `request`, or a `stalled` failure once it has taken longer than `ms`. */
async function unlessStalled<T>(request: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`no data for ${ms} ms`), {
            cacheSyncFailure: 'stalled',
          })
        ),
      ms
    );
  });
  try {
    return await Promise.race([request, stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/** A later event-loop task, through a message to ourselves (no timer clamp). */
function nextTaskViaMessage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

type ActiveRun = {
  controller: AbortController;
  finished: Promise<void>;
};

const SYNC_FAILURE_KINDS = ['busy', 'stream', 'stalled', 'aborted'] as const;

/** The failure kind the WASM engine marked on an error, if any. */
function markedFailureKind(
  error: unknown
): (typeof SYNC_FAILURE_KINDS)[number] | undefined {
  if (typeof error !== 'object' || error === null) return;
  if (!('cacheSyncFailure' in error)) return;
  const kind = error.cacheSyncFailure;
  return SYNC_FAILURE_KINDS.find((known) => known === kind);
}

/** Cancels a body or its reader; a stream that already failed rejects. */
async function cancelQuietly(
  stream: ReadableStream | ReadableStreamDefaultReader | undefined
): Promise<void> {
  try {
    await stream?.cancel();
  } catch {
    // Cancelling is best effort: the run's outcome is already decided.
  }
}

/** Marks a failed request or body read as a stream failure. */
async function network<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    throw Object.assign(new Error(messageOf(error)), {
      cacheSyncFailure: 'stream',
    });
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Reads a response body into a queue while the cache writes. Holds at most
 * `capacity` unapplied bytes, plus the one chunk read while waiting for room:
 * the consumer returns a chunk's bytes with `release` once its frames are
 * applied. Reading stops when the body ends, fails, sends nothing for
 * `stallMs` while it is being read, or `close` is called.
 */
class ReadAhead {
  private readonly chunks: Uint8Array[] = [];
  private buffered = 0;
  private ended = false;
  private closed = false;
  private failure: Error | undefined;
  private wakeReader: (() => void) | undefined;
  private wakeConsumer: (() => void) | undefined;
  private readonly pumped: Promise<void>;

  constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly capacity: number,
    private readonly stallMs: number
  ) {
    this.pumped = this.pump();
  }

  /** The next unread chunk, or `undefined` at the end of the body. */
  async next(): Promise<Uint8Array | undefined> {
    for (;;) {
      const chunk = this.chunks.shift();
      if (chunk) return chunk;
      if (this.failure) throw this.failure;
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wakeConsumer = resolve;
      });
    }
  }

  /** Returns an applied chunk's bytes to the budget. */
  release(bytes: number): void {
    this.buffered -= bytes;
    this.wake('reader');
  }

  /** Stops reading and closes the connection, dropping unread bytes. */
  async close(): Promise<void> {
    this.closed = true;
    this.chunks.length = 0;
    this.wake('reader');
    await cancelQuietly(this.reader);
    await this.pumped;
  }

  private async pump(): Promise<void> {
    try {
      while (!this.closed) {
        if (this.buffered >= this.capacity) {
          await new Promise<void>((resolve) => {
            this.wakeReader = resolve;
          });
          continue;
        }
        // Only a read counts as silence: a full buffer is the cache's wait.
        const chunk = await unlessStalled(this.reader.read(), this.stallMs);
        if (chunk.done || this.closed) break;
        this.chunks.push(chunk.value);
        this.buffered += chunk.value.byteLength;
        this.wake('consumer');
      }
    } catch (error) {
      this.failure = Object.assign(new Error(messageOf(error)), {
        cacheSyncFailure:
          markedFailureKind(error) === 'stalled' ? 'stalled' : 'stream',
      });
    } finally {
      this.ended = true;
      this.wake('consumer');
    }
  }

  private wake(side: 'reader' | 'consumer'): void {
    const wake = side === 'reader' ? this.wakeReader : this.wakeConsumer;
    if (side === 'reader') this.wakeReader = undefined;
    else this.wakeConsumer = undefined;
    wake?.();
  }
}

/** One run at a time per engine; stopping keeps every page already written. */
export class CacheSyncDriver {
  private active: ActiveRun | undefined;

  constructor(private readonly options: SyncDriverOptions) {}

  get running(): boolean {
    return this.active !== undefined;
  }

  async start(args: SyncStartArgs): Promise<SyncRunOutcome> {
    if (this.active) return { ok: false, failure: { kind: 'busy' } };
    const controller = new AbortController();
    let finish!: () => void;
    this.active = {
      controller,
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    try {
      return await this.run(args, controller.signal);
    } finally {
      this.active = undefined;
      finish();
    }
  }

  /** Stops the run in progress and resolves once it has stopped. */
  async stop(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.controller.abort();
    await active.finished;
  }

  /** Stops the run without waiting (engine drain and disposal). */
  abort(): void {
    this.active?.controller.abort();
  }

  private async run(
    args: SyncStartArgs,
    signal: AbortSignal
  ): Promise<SyncRunOutcome> {
    const { runTask } = this.options;
    const nextTask = this.options.nextTask ?? nextTaskViaMessage;
    const publisher = new CoalescedPublisher(
      this.options.publish,
      this.options.publishIntervalMs ?? SYNC_PUBLISH_INTERVAL_MS,
      this.options.now ?? (() => globalThis.performance?.now() ?? Date.now())
    );
    const stallMs = this.options.stallMs ?? SYNC_STALL_MS;
    // The connection closes on a stop and whenever the run ends, which is
    // what gives up a request that never answered.
    const connection = new AbortController();
    const closeConnection = () => connection.abort();
    signal.addEventListener('abort', closeConnection, { once: true });
    let began = false;
    let readAhead: ReadAhead | undefined;
    try {
      const body = await runTask((engine) =>
        engine.syncBegin(JSON.stringify(args))
      );
      began = true;
      if (signal.aborted) return await this.stopped(began, { kind: 'aborted' });
      const fetchImpl = this.options.fetch ?? globalThis.fetch.bind(globalThis);
      const response = await unlessStalled(
        network(
          fetchImpl(args.url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              ...args.headers,
              'content-type': 'application/json',
              accept: 'application/x-ndjson',
            },
            body,
            signal: connection.signal,
          })
        ),
        stallMs
      );
      if (!response.ok) {
        await cancelQuietly(response.body ?? undefined);
        return await this.stopped(began, {
          kind: 'http',
          status: response.status,
        });
      }
      if (!response.body) {
        return await this.stopped(began, {
          kind: 'stream',
          message: 'response has no body',
        });
      }
      readAhead = new ReadAhead(
        response.body.getReader(),
        this.options.readAheadBytes ?? SYNC_READ_AHEAD_BYTES,
        stallMs
      );
      for (;;) {
        const chunk = await readAhead.next();
        if (!chunk) break;
        let pending = await runTask((engine) => engine.syncFeed(chunk));
        for (; pending > 0; pending -= 1) {
          // Let body reads and foreground requests in before each write.
          await nextTask();
          if (signal.aborted) {
            return await this.stopped(began, { kind: 'aborted' });
          }
          publisher.push(await runTask((engine) => engine.syncApplyNext()));
        }
        readAhead.release(chunk.byteLength);
      }
      const finished = await runTask((engine) => engine.syncFinish());
      began = false;
      return finished.ok
        ? { ok: true, result: finished.result }
        : {
            ok: false,
            failure: { kind: 'stream', message: finished.message },
            partial: finished.partial,
          };
    } catch (error) {
      if (signal.aborted) return await this.stopped(began, { kind: 'aborted' });
      // Close the connection first, so the server stops running pages. The
      // abort is what drops a connection that went silent.
      closeConnection();
      await readAhead?.close();
      const failure = match(markedFailureKind(error))
        .returnType<SyncFailure>()
        .with('busy', () => ({ kind: 'busy' }))
        .with('aborted', () => ({ kind: 'aborted' }))
        .with('stream', () => ({ kind: 'stream', message: messageOf(error) }))
        .with('stalled', () => ({ kind: 'stalled' }))
        .with(undefined, () => {
          this.options.reportEngineError(error);
          return { kind: 'write', message: messageOf(error) };
        })
        .exhaustive(() => ({ kind: 'stream', message: messageOf(error) }));
      // A busy start belongs to another run; never abort that one.
      return await this.stopped(began && failure.kind !== 'busy', failure);
    } finally {
      // Every written page is published, whatever ended the run.
      publisher.flush();
      // Every exit closes the connection (a no-op once the body ended).
      await readAhead?.close();
      signal.removeEventListener('abort', closeConnection);
      closeConnection();
    }
  }

  /** Drops the engine's run (keeping written pages) and reports `failure`. */
  private async stopped(
    began: boolean,
    failure: SyncFailure
  ): Promise<SyncRunOutcome> {
    if (!began) return { ok: false, failure };
    let partial: SyncRunResult | null = null;
    try {
      partial = await this.options.runTask((engine) => engine.syncAbort());
    } catch {
      // A closed or reset engine dropped its run already.
    }
    return partial ? { ok: false, failure, partial } : { ok: false, failure };
  }
}
