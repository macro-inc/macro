import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldRequest, FoldResponse } from './protocol';

const workers: FakeWorker[] = [];

class FakeWorker extends EventTarget {
  readonly requests: FoldRequest[] = [];

  constructor() {
    super();
    workers.push(this);
  }

  postMessage(request: FoldRequest): void {
    this.requests.push(request);
  }

  reply(response: FoldResponse): void {
    this.dispatchEvent(new MessageEvent('message', { data: response }));
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  workers.length = 0;
});

describe('agent fold preloading', () => {
  it('stays lazy until focus and initializes without creating a session or making an API call', async () => {
    const { preloadAgentFold } = await import('./client');
    expect(workers).toHaveLength(0);

    const ready = preloadAgentFold();
    const worker = workers[0]!;
    expect(worker.requests).toEqual([{ id: 0, kind: 'preload' }]);
    expect(fetch).not.toHaveBeenCalled();
    worker.reply({ id: 0, kind: 'preload', ok: true });
    await ready;

    await preloadAgentFold();
    expect(workers).toHaveLength(1);
    expect(worker.requests).toHaveLength(1);
  });

  it('uses the same worker for repeated focus and a prompt that arrives during initialization', async () => {
    const { preloadAgentFold, pushSession } = await import('./client');
    const ready = preloadAgentFold();
    await preloadAgentFold();
    const pushed = pushSession('session', [{ kind: 'snapshot', rows: [] }]);
    const worker = workers[0]!;
    expect(workers).toHaveLength(1);
    expect(worker.requests.map((request) => request.kind)).toEqual([
      'preload',
      'push',
    ]);
    worker.reply({ id: 0, kind: 'preload', ok: true });
    worker.reply({ id: 1, kind: 'push', ok: true, changes: [] });
    await ready;
    await expect(pushed).resolves.toEqual([]);
  });

  it('does no extra work when a real session has already started the worker', async () => {
    const { preloadAgentFold, pushSession } = await import('./client');
    const pushed = pushSession('session', [{ kind: 'snapshot', rows: [] }]);
    await preloadAgentFold();
    const worker = workers[0]!;
    expect(workers).toHaveLength(1);
    expect(worker.requests.map((request) => request.kind)).toEqual(['push']);
    worker.reply({ id: 0, kind: 'push', ok: true, changes: [] });
    await pushed;
  });

  it('contains worker startup errors and lets a later session start a fresh worker', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { preloadAgentFold, pushSession } = await import('./client');
    const ready = preloadAgentFold();
    workers[0]!.dispatchEvent(
      new ErrorEvent('error', { message: 'module could not load' })
    );
    await ready;
    expect(warning).toHaveBeenCalledOnce();

    const pushed = pushSession('session', [{ kind: 'snapshot', rows: [] }]);
    expect(workers).toHaveLength(2);
    workers[1]!.reply({ id: 1, kind: 'push', ok: true, changes: [] });
    await expect(pushed).resolves.toEqual([]);
  });

  // The three ways a worker can fail are distinguishable, and the browser
  // tells them apart only by the error event's message. Measured in Chrome: a
  // script that 404s reports no message at all; one that loads and throws
  // reports what it threw; a failure inside the worker never reaches `error`
  // and comes back as an ordinary reply.
  it('reports a script that never loaded as the build being gone', async () => {
    const { AgentFoldWorkerUnavailable, pushSession } = await import(
      './client'
    );
    const pushed = pushSession('session', [{ kind: 'snapshot', rows: [] }]);

    workers[0]!.dispatchEvent(new ErrorEvent('error', { message: '' }));

    const error = await pushed.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AgentFoldWorkerUnavailable);
    expect((error as Error).message).toContain('no longer served');
    // The chunk names the build, which is the whole diagnosis.
    expect((error as Error).message).toContain('fold.worker');
  });

  it('reports a script that loaded and threw as a startup failure', async () => {
    const { AgentFoldWorkerUnavailable, pushSession } = await import(
      './client'
    );
    const pushed = pushSession('session', [{ kind: 'snapshot', rows: [] }]);

    workers[0]!.dispatchEvent(
      new ErrorEvent('error', { message: 'Uncaught Error: wasm exploded' })
    );

    const error = await pushed.catch((reason: unknown) => reason);
    expect(error).not.toBeInstanceOf(AgentFoldWorkerUnavailable);
    expect((error as Error).message).toContain('wasm exploded');
  });

  it('rejects every fold in flight from one worker failure', async () => {
    const { pushSession } = await import('./client');
    const first = pushSession('a', [{ kind: 'snapshot', rows: [] }]);
    const second = pushSession('b', [{ kind: 'snapshot', rows: [] }]);

    workers[0]!.dispatchEvent(new ErrorEvent('error', { message: '' }));

    // One cause, two reports: why a single failure looks like many in Datadog.
    const [a, b] = await Promise.all([
      first.catch((reason: unknown) => reason),
      second.catch((reason: unknown) => reason),
    ]);
    expect((a as Error).name).toBe('AgentFoldWorkerUnavailable');
    expect((b as Error).name).toBe('AgentFoldWorkerUnavailable');
  });

  it('contains constructor failures without preventing a later real load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('worker unavailable');
        }
      }
    );
    const { preloadAgentFold, pushSession } = await import('./client');
    await expect(preloadAgentFold()).resolves.toBeUndefined();

    vi.stubGlobal('Worker', FakeWorker);
    const pushed = pushSession('session', [{ kind: 'snapshot', rows: [] }]);
    workers[0]!.reply({ id: 1, kind: 'push', ok: true, changes: [] });
    await expect(pushed).resolves.toEqual([]);
  });
});
