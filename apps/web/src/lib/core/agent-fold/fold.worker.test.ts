import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FoldRequest, FoldResponse } from './protocol';

const fold = vi.hoisted(() => ({
  initialize: vi.fn(),
  open: vi.fn(),
  push: vi.fn(() => []),
}));

vi.mock('./wasm-module', () => ({
  loadAgentFoldWasm: fold.initialize,
}));

class WorkerScope extends EventTarget {
  postMessage = vi.fn<(response: FoldResponse) => void>();

  send(request: FoldRequest): void {
    this.dispatchEvent(new MessageEvent('message', { data: request }));
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => vi.unstubAllGlobals());

it('initializes on preload without opening a fold, then processes a session after initialization', async () => {
  const scope = new WorkerScope();
  vi.stubGlobal('self', scope);
  let initialize!: () => void;
  const initialized = new Promise<void>((resolve) => {
    initialize = resolve;
  });
  fold.initialize.mockImplementation(async () => {
    await initialized;
    return {
      FoldStream: class {
        push = fold.push;

        constructor(id: string) {
          fold.open(id);
        }
      },
    };
  });
  await import('./fold.worker');
  expect(fold.initialize).not.toHaveBeenCalled();

  scope.send({ id: 1, kind: 'preload' });
  await vi.waitFor(() => expect(fold.initialize).toHaveBeenCalledOnce());
  expect(fold.open).not.toHaveBeenCalled();
  expect(scope.postMessage).not.toHaveBeenCalled();

  scope.send({
    id: 2,
    kind: 'push',
    sessionId: 'session',
    inputs: [{ kind: 'snapshot', rows: [] }],
  });
  initialize();
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(2));
  expect(
    scope.postMessage.mock.calls.map(([response]) =>
      response.ok ? response.kind : response.error
    )
  ).toEqual(['preload', 'push']);
  expect(fold.open).toHaveBeenCalledExactlyOnceWith('session');
  expect(fold.push).toHaveBeenCalledExactlyOnceWith([
    { kind: 'snapshot', rows: [] },
  ]);
});
