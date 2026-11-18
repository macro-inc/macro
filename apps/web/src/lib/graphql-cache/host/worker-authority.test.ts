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

it('keeps offline reads available before any proof and across a preserved owner replacement', async () => {
  await host.authority!.current();
  const read = () =>
    host.readQuery({ query: '{ user { emailThread { id } } }' });
  await expect(read()).resolves.toMatchObject({ kind: 'hit' });
  options.onEngineReplaced?.(2, 'opened-existing');
  await expect(read()).resolves.toMatchObject({ kind: 'hit' });
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

it('accepts a current transition after cold host initialization', async () => {
  const result = await host.authority!.transition(state.generation, 'none');
  expect(result.authority).toEqual(state);
  expect(result.changed).toBe(true);
});

it('rejects a late transition reply after a newer owner event', async () => {
  await host.authority!.current();
  const post = adapter.postMessage;
  const started =
    Promise.withResolvers<
      Extract<CacheRequest, { kind: 'transition-authority' }>
    >();
  adapter.postMessage = (request) => {
    if (request.kind === 'transition-authority') started.resolve(request);
    else post(request);
  };
  const pending = host.authority!.transition(state.generation, 'none');
  const request = await started.promise;
  expect(request.expected).toBe(state.generation);
  const earlier = {
    ...state,
    generation: crypto.randomUUID(),
    ready: true,
    policy: 'none',
  };
  state = { ...earlier, generation: crypto.randomUUID(), policy: 'denied' };
  adapter.onmessage?.(
    new MessageEvent<WorkerMessage>('message', {
      data: { kind: 'authority-changed', authority: state },
    })
  );
  expect(host.authority!.snapshot()).toEqual(state);

  const rejected = expect(pending).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );
  adapter.onmessage?.(
    new MessageEvent<WorkerMessage>('message', {
      data: {
        id: request.id,
        ok: true,
        result: {
          authority: earlier,
          changed: true,
          affectedOps: [],
          revision: '0',
        },
        authorityGeneration: earlier.generation,
      },
    })
  );
  await rejected;
  expect(host.authority!.snapshot()).toEqual(state);
});

it('retains the request generation when a deletion crosses an owner transition', async () => {
  await host.authority!.current();
  const original = state.generation;
  await host.authority!.transition(original, 'team:denied');
  const post = adapter.postMessage;
  adapter.postMessage = vi.fn((request) => {
    if (request.kind !== 'delete-records') return post(request);
    expect(request.generation).toBe(original);
    queueMicrotask(() =>
      adapter.onmessage?.(
        new MessageEvent<WorkerMessage>('message', {
          data: {
            id: request.id,
            ok: false,
            error: 'cache response belongs to an older session generation',
          },
        })
      )
    );
  });
  await expect(
    host.deleteRecords(['GraphqlSoupDocument:one'], original)
  ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
});
