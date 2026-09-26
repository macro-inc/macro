import { afterEach, expect, it, vi } from 'vitest';
import {
  createPreparationExecutor,
  type WorkerRequest,
  type WorkerResponse,
} from './executor';

afterEach(() => vi.unstubAllGlobals());

it('starts lazily and permanently falls back after a failed worker start', async () => {
  const start = vi.fn(() => {
    throw new Error('Unsupported origin');
  });
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        start();
      }
    }
  );
  const executor = createPreparationExecutor();
  expect(start).not.toHaveBeenCalled();
  expect((await executor.hashSource({ html: '<p>Hello</p>' })).length).toBe(64);
  expect((await executor.prepare({ html: '<p>Hello</p>' }, {}, 1)).html).toBe(
    '<p>Hello</p>'
  );
  expect(start).toHaveBeenCalledTimes(1);
  executor.dispose();
  await expect(executor.prepare({ html: 'late' }, {})).rejects.toThrow(
    'disposed'
  );
});

it('terminates a hung worker once and ignores responses after disposal', async () => {
  const terminate = vi.fn();
  vi.stubGlobal(
    'Worker',
    class {
      postMessage() {}
      terminate = terminate;
    }
  );
  const executor = createPreparationExecutor();
  const pending = executor.prepare({ html: 'late' }, {}, 1);
  executor.dispose();
  await expect(pending).rejects.toThrow('disposed');
  expect(terminate).toHaveBeenCalledTimes(1);
});

it('does not start a worker for hashing or a bounded foreground miss', async () => {
  const start = vi.fn(() => {
    throw new Error('Foreground must not depend on worker startup');
  });
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        start();
      }
    }
  );
  const executor = createPreparationExecutor();
  expect((await executor.hashSource({ html: '<p>Hello</p>' })).length).toBe(64);
  expect((await executor.hash('policy')).length).toBe(64);
  expect((await executor.prepare({ html: '<p>Hello</p>' }, {})).html).toBe(
    '<p>Hello</p>'
  );
  expect(start).not.toHaveBeenCalled();
  executor.dispose();
  await expect(executor.hash('late')).rejects.toThrow('disposed');
});

it('keeps large foreground bodies and speculative preparation in one worker', async () => {
  const messages: WorkerRequest[] = [];
  const start = vi.fn();
  const terminate = vi.fn();
  vi.stubGlobal(
    'Worker',
    class {
      onmessage?: (event: MessageEvent<WorkerResponse>) => void;
      constructor() {
        start();
      }
      postMessage(request: WorkerRequest) {
        messages.push(request);
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              id: request.id,
              result: {
                html: 'prepared in worker',
                kind: 'html',
                hasTable: false,
                hasHiddenContent: false,
              },
            },
          } as MessageEvent<WorkerResponse>)
        );
      }
      terminate = terminate;
    }
  );
  const executor = createPreparationExecutor();
  const input = { html: 'x'.repeat(130 * 1024), text: 'x'.repeat(130 * 1024) };
  expect((await executor.prepare(input, {})).html).toBe('prepared in worker');
  expect((await executor.prepare({ html: 'small' }, {}, 2)).html).toBe(
    'prepared in worker'
  );
  expect((await executor.prepare({ html: '<p>foreground</p>' }, {})).html).toBe(
    '<p>foreground</p>'
  );
  expect(start).toHaveBeenCalledTimes(1);
  expect(messages.map((request) => request.kind)).toEqual([
    'prepare',
    'prepare',
  ]);
  executor.dispose();
  expect(terminate).toHaveBeenCalledTimes(1);
});
