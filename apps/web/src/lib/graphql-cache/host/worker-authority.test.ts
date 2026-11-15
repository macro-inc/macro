import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type CacheAuthority, StaleCacheAuthorityError } from '../authority';
import type { CacheRequest, WorkerMessage } from '../protocol';
import type { CacheCoordinatorPageAdapterOptions } from '../worker/coordinator-page-adapter';

const factory = vi.hoisted(() => vi.fn());
vi.mock('../worker/coordinator-page-adapter', () => ({
  createCacheCoordinatorPageAdapter: factory,
}));

import { createWorkerCacheHost } from './worker-host';

let state: CacheAuthority;
let adapter: {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  start: () => Promise<void>;
  dispose: () => Promise<void>;
  postMessage: (request: CacheRequest) => void;
};
let options: CacheCoordinatorPageAdapterOptions;
let host: ReturnType<typeof createWorkerCacheHost>;

beforeEach(() => {
  state = {
    identity: 'authority-test',
    account: 'viewer',
    generation: crypto.randomUUID(),
    policy: null,
    ready: false,
  };
  vi.stubGlobal('SharedWorker', vi.fn());
  vi.stubGlobal('Worker', vi.fn());
  vi.stubGlobal('MessageChannel', vi.fn());
  vi.stubGlobal('navigator', {
    storage: { getDirectory: vi.fn() },
    locks: { request: vi.fn(async (_name, _options, callback) => callback()) },
  });
  localStorage.setItem('graphql-cache:scope', state.identity);
  factory.mockImplementation((next: CacheCoordinatorPageAdapterOptions) => {
    options = next;
    adapter = {
      onmessage: null,
      start: async () => {},
      dispose: async () => {},
      postMessage(request) {
        let result: unknown = null;
        if (request.kind === 'current-authority') result = state;
        if (request.kind === 'transition-authority') {
          expect(request.expected).toBe(state.generation);
          const changed = !state.ready || state.policy !== request.policy;
          if (changed)
            state = {
              ...state,
              generation: crypto.randomUUID(),
              ready: true,
              policy: request.policy,
            };
          result = {
            authority: state,
            changed,
            affectedOps: [],
            revision: '0',
          };
        }
        if (request.kind === 'read')
          result = {
            kind: 'hit',
            data: { user: { emailThread: { id: 'thread' } } },
          };
        queueMicrotask(() =>
          adapter.onmessage?.({
            data: {
              id: request.id,
              ok: true,
              result,
              authorityGeneration: state.generation,
            },
          } as MessageEvent<WorkerMessage>)
        );
      },
    };
    return adapter;
  });
  host = createWorkerCacheHost({ scope: state.identity });
});
afterEach(() => {
  host.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('requires a proof again after a preserved owner replacement', async () => {
  await host.authority!.current();
  const read = () =>
    host.readQuery({ query: '{ user { emailThread { id } } }' });
  await expect(read()).rejects.toBeInstanceOf(StaleCacheAuthorityError);
  const transitions: boolean[] = [];
  const proof = vi.fn(async () => {
    const result = await host.authority!.transition(
      (await host.authority!.current()).generation,
      'none'
    );
    transitions.push(result.changed);
  });
  host.authority!.setReadGuard(proof);
  await expect(read()).resolves.toMatchObject({ kind: 'hit' });
  expect(proof).toHaveBeenCalledOnce();
  const preservedGeneration = state.generation;
  options.onEngineReplaced?.(2, 'opened-existing');
  await host.authority!.current();
  host.authority!.setReadGuard(async () => {});
  await expect(read()).rejects.toBeInstanceOf(StaleCacheAuthorityError);
  host.authority!.setReadGuard(proof);
  await expect(read()).resolves.toMatchObject({ kind: 'hit' });
  expect(proof).toHaveBeenCalledTimes(2);
  expect(transitions).toEqual([true, false]);
  expect(state.generation).toBe(preservedGeneration);
});

it('broadens unknown or stale pushes to rereads without delivering their field content', async () => {
  await host.authority!.current();
  const affected = vi.fn();
  host.onOpsAffected(affected);
  const fieldChanges = [
    { kind: 'invalidate' as const, key: 'GraphqlSoupEmailThread:thread' },
  ];
  const push = (generation?: string) =>
    adapter.onmessage?.(
      new MessageEvent<WorkerMessage>('message', {
        data: {
          kind: 'ops-affected',
          opIds: [`${host.clientId}:7`],
          keys: [],
          fieldChanges,
          authorityGeneration: generation,
        },
      })
    );
  push();
  push(crypto.randomUUID());
  push(state.generation);
  expect(affected.mock.calls).toEqual([[[7]], [[7]], [[7], fieldChanges]]);
});
