import { describe, expect, it, vi } from 'vitest';
import type { CacheRevision } from '../protocol';
import type { SyncRunResult, SyncStartArgs } from '../sync-protocol';
import {
  CacheSyncDriver,
  type SyncAppliedWire,
  type SyncEngine,
} from './sync-driver';

const ARGS: SyncStartArgs = {
  url: 'https://api.example.test/items/soup/graphql/stream',
  headers: { 'x-macro-mail-cache-profile': 'v2' },
  lanes: [
    {
      id: 'tasks',
      query: 'query SoupBackfillSyncTasks { user { id } }',
      variables: { input: { initial: { limit: 500 } } },
      paging: 'soup',
      kind: { kind: 'hydrate' },
      passStartedAt: '2026-11-01T00:00:00.000Z',
    },
  ],
};

const RESULT: SyncRunResult = {
  reason: 'complete',
  durationMs: 5,
  bytes: 10,
  lanes: [{ id: 'tasks', pages: 1, items: 2, writeMs: 1, done: true }],
};

const HYDRATED: SyncAppliedWire = {
  kind: 'hydrated',
  lane: 'tasks',
  write: {
    revision: '1' as CacheRevision,
    revisionAdvanced: true,
    changed: [],
    affectedOps: [],
    reset: false,
    revalidations: [],
  },
};

const encoder = new TextEncoder();

function body(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** A body that yields `chunks`, then waits until the request is aborted. */
function hangingBody(
  chunks: string[],
  signal: AbortSignal
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      signal.addEventListener('abort', () =>
        controller.error(new DOMException('aborted', 'AbortError'))
      );
    },
  });
}

function fakeEngine(pendingPerChunk: number[]): SyncEngine & {
  [K in keyof SyncEngine]: ReturnType<typeof vi.fn>;
} {
  const pending = [...pendingPerChunk];
  return {
    syncBegin: vi.fn().mockResolvedValue('{"lanes":[]}'),
    syncFeed: vi.fn(async () => pending.shift() ?? 0),
    syncApplyNext: vi.fn().mockResolvedValue(HYDRATED),
    syncFinish: vi.fn().mockResolvedValue({ ok: true, result: RESULT }),
    syncAbort: vi.fn().mockResolvedValue({ ...RESULT, reason: 'maxPages' }),
    syncState: vi.fn().mockResolvedValue([]),
  };
}

/**
 * A body that hands out one chunk per read (no stream-side read-ahead),
 * counting reads, and records whether the connection was cancelled. With
 * `hang`, the body never ends after its chunks (the server is still sending).
 */
function pulledBody(chunks: string[], { hang = false } = {}) {
  const queue = [...chunks];
  const state = { reads: 0, cancelled: false, onRead: () => {} };
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const chunk = queue.shift();
        if (chunk === undefined) {
          if (hang) await new Promise(() => {});
          controller.close();
          return;
        }
        state.reads += 1;
        controller.enqueue(encoder.encode(chunk));
        state.onRead();
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 }
  );
  return { stream, state };
}

/** Resolves once `condition` holds, checked after every body read. */
function whenRead(state: { onRead: () => void }, condition: () => boolean) {
  return new Promise<void>((resolve) => {
    state.onRead = () => {
      if (condition()) resolve();
    };
  });
}

/** Lets pending reads run: a few event-loop turns. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function driver(
  engine: SyncEngine,
  fetch: typeof globalThis.fetch,
  reportEngineError = vi.fn(),
  options: {
    readAheadBytes?: number;
    publishIntervalMs?: number;
    now?: () => number;
  } = {}
) {
  const published: SyncAppliedWire[] = [];
  const tasks: string[] = [];
  const nextTask = vi.fn(async () => {});
  const sync = new CacheSyncDriver({
    runTask: async (task) => {
      tasks.push('task');
      return await task(engine);
    },
    publish: (applied) => published.push(applied),
    reportEngineError,
    fetch,
    nextTask,
    publishIntervalMs: 0,
    ...options,
  });
  return { sync, published, tasks, nextTask };
}

describe('CacheSyncDriver', () => {
  it('posts the engine-built body and applies every decoded frame in order', async () => {
    const engine = fakeEngine([1, 0, 2]);
    const fetch = vi.fn(
      async () => new Response(body(['{"type":', '"page"}\n', 'x\ny\n']))
    );
    const { sync, published, nextTask } = driver(engine, fetch);

    await expect(sync.start(ARGS)).resolves.toEqual({
      ok: true,
      result: RESULT,
    });

    expect(engine.syncBegin).toHaveBeenCalledWith(JSON.stringify(ARGS));
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ARGS.url);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: '{"lanes":[]}',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
        'x-macro-mail-cache-profile': 'v2',
      },
    });
    expect(engine.syncFeed).toHaveBeenCalledTimes(3);
    expect(engine.syncApplyNext).toHaveBeenCalledTimes(3);
    expect(published).toEqual([HYDRATED, HYDRATED, HYDRATED]);
    // Every write waits for a later task, so reads and port messages go first.
    expect(nextTask).toHaveBeenCalledTimes(3);
    expect(engine.syncFinish).toHaveBeenCalledOnce();
    expect(engine.syncAbort).not.toHaveBeenCalled();
    expect(sync.running).toBe(false);
  });

  it('finishes a run with a failed lane and reports that lane', async () => {
    // tasks page, the tasks laneError, docs page: the engine records the
    // laneError and carries on, so the run completes.
    const engine = fakeEngine([3]);
    engine.syncApplyNext
      .mockResolvedValueOnce(HYDRATED)
      .mockResolvedValueOnce({ kind: 'recorded' })
      .mockResolvedValueOnce({ ...HYDRATED, lane: 'docs' });
    const result: SyncRunResult = {
      ...RESULT,
      lanes: [
        {
          id: 'tasks',
          pages: 1,
          items: 2,
          writeMs: 1,
          done: false,
          error: 'page response has GraphQL errors',
        },
        { id: 'docs', pages: 1, items: 1, writeMs: 1, done: true },
      ],
    };
    engine.syncFinish.mockResolvedValue({ ok: true, result });
    const fetch = vi.fn(async () => new Response(body(['a\nb\nc\n'])));
    const { sync, published } = driver(engine, fetch);

    await expect(sync.start(ARGS)).resolves.toEqual({ ok: true, result });
    expect(engine.syncApplyNext).toHaveBeenCalledTimes(3);
    expect(published).toEqual([
      HYDRATED,
      { kind: 'recorded' },
      { ...HYDRATED, lane: 'docs' },
    ]);
    expect(engine.syncAbort).not.toHaveBeenCalled();
    expect(sync.running).toBe(false);
  });

  it('reports non-2xx responses as http failures and drops the run', async () => {
    const engine = fakeEngine([]);
    const { sync } = driver(
      engine,
      vi.fn(async () => new Response('busy', { status: 409 }))
    );
    await expect(sync.start(ARGS)).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 409 },
      partial: { ...RESULT, reason: 'maxPages' },
    });
    expect(engine.syncAbort).toHaveBeenCalledOnce();
    expect(engine.syncFeed).not.toHaveBeenCalled();
  });

  it('allows one run at a time and stops it on request, keeping progress', async () => {
    const engine = fakeEngine([1]);
    let fetched!: () => void;
    const fetchedOnce = new Promise<void>((resolve) => {
      fetched = resolve;
    });
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      fetched();
      return new Response(hangingBody(['{}\n'], init!.signal!));
    });
    const { sync } = driver(engine, fetch as typeof globalThis.fetch);

    const first = sync.start(ARGS);
    await fetchedOnce;
    await expect(sync.start(ARGS)).resolves.toEqual({
      ok: false,
      failure: { kind: 'busy' },
    });
    await sync.stop();
    await expect(first).resolves.toEqual({
      ok: false,
      failure: { kind: 'aborted' },
      partial: { ...RESULT, reason: 'maxPages' },
    });
    expect(engine.syncAbort).toHaveBeenCalledOnce();
    expect(sync.running).toBe(false);
  });

  it('classifies engine stream errors and write errors', async () => {
    const streamEngine = fakeEngine([]);
    streamEngine.syncFeed.mockRejectedValue(
      Object.assign(new Error('invalid frame'), { cacheSyncFailure: 'stream' })
    );
    const { sync: streamSync } = driver(
      streamEngine,
      vi.fn(async () => new Response(body(['{}\n'])))
    );
    await expect(streamSync.start(ARGS)).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'stream', message: 'invalid frame' },
    });

    const writeEngine = fakeEngine([1]);
    const writeError = new Error('disk full');
    writeEngine.syncApplyNext.mockRejectedValue(writeError);
    const reportEngineError = vi.fn();
    const { sync: writeSync } = driver(
      writeEngine,
      vi.fn(async () => new Response(body(['{}\n']))),
      reportEngineError
    );
    await expect(writeSync.start(ARGS)).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'write', message: 'disk full' },
    });
    expect(reportEngineError).toHaveBeenCalledWith(writeError);
    expect(writeEngine.syncAbort).toHaveBeenCalledOnce();
  });

  it('reports a stream that closed early as a stream failure with progress', async () => {
    const engine = fakeEngine([1]);
    engine.syncFinish.mockResolvedValue({
      ok: false,
      message: 'stream closed without an end frame',
      partial: { ...RESULT, reason: 'maxPages' },
    });
    const { sync } = driver(
      engine,
      vi.fn(async () => new Response(body(['{}\n'])))
    );
    await expect(sync.start(ARGS)).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'stream',
        message: 'stream closed without an end frame',
      },
      partial: { ...RESULT, reason: 'maxPages' },
    });
  });
  it('keeps reading the body while a frame is being written', async () => {
    const engine = fakeEngine([1, 1, 1, 1]);
    const { stream, state } = pulledBody(['a\n', 'b\n', 'c\n', 'd\n']);
    const allRead = whenRead(state, () => state.reads === 4);
    let firstWrite = true;
    engine.syncApplyNext.mockImplementation(async () => {
      // The first write finishes only once the rest of the body was read.
      if (firstWrite) {
        firstWrite = false;
        await allRead;
      }
      return HYDRATED;
    });
    const { sync, published } = driver(
      engine,
      vi.fn(async () => new Response(stream))
    );

    await expect(sync.start(ARGS)).resolves.toEqual({
      ok: true,
      result: RESULT,
    });
    expect(published).toHaveLength(4);
    expect(
      engine.syncFeed.mock.calls.map(([bytes]) => bytes.byteLength)
    ).toEqual([2, 2, 2, 2]);
  });

  it('stops reading at the byte budget and resumes as frames apply', async () => {
    const engine = fakeEngine([1, 1, 1, 1, 1]);
    const { stream, state } = pulledBody(['a', 'b', 'c', 'd', 'e']);
    let releaseFirstWrite!: () => void;
    const firstWriteDone = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let readsDuringFirstWrite: number | undefined;
    let firstWrite = true;
    engine.syncApplyNext.mockImplementation(async () => {
      if (firstWrite) {
        firstWrite = false;
        await settle();
        readsDuringFirstWrite = state.reads;
        await firstWriteDone;
      }
      return HYDRATED;
    });
    const { sync, published } = driver(
      engine,
      vi.fn(async () => new Response(stream)),
      vi.fn(),
      { readAheadBytes: 2 }
    );

    const run = sync.start(ARGS);
    await vi.waitFor(() => expect(readsDuringFirstWrite).toBeDefined());
    // Two unapplied bytes fill the budget: the body is not read further.
    expect(readsDuringFirstWrite).toBe(2);
    releaseFirstWrite();
    await expect(run).resolves.toMatchObject({ ok: true });
    expect(state.reads).toBe(5);
    expect(published).toHaveLength(5);
  });

  it('closes the connection when a write fails, keeping written pages', async () => {
    const engine = fakeEngine([1, 1]);
    const { stream, state } = pulledBody(['a\n', 'b\n', 'c\n'], { hang: true });
    engine.syncApplyNext
      .mockResolvedValueOnce(HYDRATED)
      .mockRejectedValueOnce(new Error('disk full'));
    const { sync, published } = driver(
      engine,
      vi.fn(async () => new Response(stream))
    );

    await expect(sync.start(ARGS)).resolves.toEqual({
      ok: false,
      failure: { kind: 'write', message: 'disk full' },
      partial: { ...RESULT, reason: 'maxPages' },
    });
    expect(published).toEqual([HYDRATED]);
    expect(state.cancelled).toBe(true);
    expect(engine.syncAbort).toHaveBeenCalledOnce();
    expect(engine.syncFinish).not.toHaveBeenCalled();
  });

  it('closes the connection when stopped with bytes still buffered', async () => {
    const engine = fakeEngine([1, 1, 1]);
    const { stream, state } = pulledBody(['a\n', 'b\n', 'c\n', 'd\n'], {
      hang: true,
    });
    let stopping!: () => void;
    const stopped = new Promise<void>((resolve) => {
      stopping = resolve;
    });
    engine.syncApplyNext.mockImplementation(async () => {
      stopping();
      await settle();
      return HYDRATED;
    });
    const { sync, published } = driver(
      engine,
      vi.fn(async () => new Response(stream))
    );

    const run = sync.start(ARGS);
    await stopped;
    await sync.stop();
    await expect(run).resolves.toEqual({
      ok: false,
      failure: { kind: 'aborted' },
      partial: { ...RESULT, reason: 'maxPages' },
    });
    // The write in progress finished; no later frame was applied.
    expect(published).toEqual([HYDRATED]);
    expect(state.cancelled).toBe(true);
    expect(engine.syncFinish).not.toHaveBeenCalled();
  });
  it('coalesces hydrated pages into one publication per interval', async () => {
    const hydrated = (
      revision: string,
      buckets?: string[]
    ): SyncAppliedWire => ({
      kind: 'hydrated',
      lane: 'tasks',
      write: {
        revision: revision as CacheRevision,
        revisionAdvanced: true,
        changed: [],
        affectedOps: [],
        reset: false,
        revalidations: [],
        ...(buckets ? { searchChangedBuckets: buckets } : {}),
      },
    });
    const engine = fakeEngine([5]);
    const frames: SyncAppliedWire[] = [
      hydrated('1', ['task']),
      hydrated('2', ['task']),
      hydrated('3', ['email']),
      { kind: 'recorded' },
      hydrated('4', ['task']),
    ];
    engine.syncApplyNext.mockImplementation(async () => frames.shift());
    let clock = 0;
    const { sync, published } = driver(
      engine,
      vi.fn(async () => new Response(body(['x\n']))),
      vi.fn(),
      { publishIntervalMs: 250, now: () => (clock += 10) }
    );

    await expect(sync.start(ARGS)).resolves.toMatchObject({ ok: true });
    expect(published).toEqual([
      // The first page publishes at once.
      hydrated('1', ['task']),
      // Later pages within the interval merge; a non-page frame flushes them.
      hydrated('3', ['task', 'email']),
      { kind: 'recorded' },
      // Whatever is pending when the run ends is published.
      hydrated('4', ['task']),
    ]);
  });
});
