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
