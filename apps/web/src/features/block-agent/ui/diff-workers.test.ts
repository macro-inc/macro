/** @vitest-environment jsdom */

import { waitFor } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useDiffWorkers } from './diff-workers';

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  initialize: vi.fn<() => Promise<void>>(),
  terminate: vi.fn(),
  worker: vi.fn(),
}));
vi.mock('@pierre/diffs/worker', () => ({
  WorkerPoolManager: class {
    constructor(...args: unknown[]) {
      mocks.construct(...args);
    }
    initialize = mocks.initialize;
    terminate = mocks.terminate;
  },
}));
vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({
  default: mocks.worker,
}));

describe('diff workers', () => {
  it('starts lazily, shares the pool, and terminates after the last body unmounts', async () => {
    expect(mocks.construct).not.toHaveBeenCalled();
    let resolve!: () => void;
    mocks.initialize.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      })
    );
    const first = createRoot((dispose) => ({
      dispose,
      state: useDiffWorkers(),
    }));
    const second = createRoot((dispose) => ({
      dispose,
      state: useDiffWorkers(),
    }));
    expect(mocks.construct).toHaveBeenCalledTimes(1);
    expect(first.state).toBe(second.state);
    expect(first.state().kind).toBe('loading');
    resolve();
    await waitFor(() => expect(first.state().kind).toBe('ready'));
    first.dispose();
    await Promise.resolve();
    expect(mocks.terminate).not.toHaveBeenCalled();
    second.dispose();
    await waitFor(() => expect(mocks.terminate).toHaveBeenCalledTimes(1));
  });

  it('reports initialization failure without exposing a pool that falls back to the main thread', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.initialize.mockRejectedValue(new Error('worker unavailable'));
    const root = createRoot((dispose) => ({
      dispose,
      state: useDiffWorkers(),
    }));
    await waitFor(() => expect(root.state().kind).toBe('failed'));
    root.dispose();
    await Promise.resolve();
    error.mockRestore();
  });
});
