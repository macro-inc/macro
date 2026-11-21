import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type CacheAuthority, StaleCacheAuthorityError } from '../authority';
import { UNKNOWN_CACHE_GENERATION } from '../generation-mirror';
import type { CacheRequest, WorkerMessage } from '../protocol';
import type { CacheCoordinatorPageAdapterOptions } from '../worker/coordinator-page-adapter';

const factory = vi.hoisted(() => vi.fn());
vi.mock('../worker/coordinator-page-adapter', () => ({
  createCacheCoordinatorPageAdapter: factory,
}));

import { createWorkerCacheHost } from './worker-host';

let state: CacheAuthority;
let requests: CacheRequest[];
let adapter: {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  start: () => Promise<void>;
  dispose: () => Promise<void>;
  postMessage: (request: CacheRequest) => void;
};
let options: CacheCoordinatorPageAdapterOptions;
let host: ReturnType<typeof createWorkerCacheHost>;

beforeEach(() => {
  requests = [];
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
        requests.push(request);
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

it.each([
  { phase: 'startup', reply: 'stale' },
  { phase: 'refresh', reply: 'stale' },
  { phase: 'startup', reply: 'foreign' },
  { phase: 'startup', reply: 'malformed' },
] as const)(
  'handles a held $phase authority $reply reply after a newer push',
  async ({ phase, reply }) => {
    host.dispose();
    const makeAdapter = factory.getMockImplementation()!;
    const started = Promise.withResolvers<CacheRequest>();
    let hold = phase === 'startup';
    let held = false;
    factory.mockImplementation((options) => {
      const connection = makeAdapter(options) as typeof adapter;
      const post = connection.postMessage;
      connection.postMessage = (request) => {
        if (hold && !held && request.kind === 'current-authority') {
          held = true;
          started.resolve(request);
        } else post(request);
      };
      return connection;
    });
    state = { ...state, account: null };
    const initial = state;
    const failed = vi.fn();
    host = createWorkerCacheHost({
      scope: state.identity,
      onInitializationError: failed,
    });
    if (phase === 'refresh') {
      await host.authority!.current();
      hold = true;
    }
    const pending =
      phase === 'startup'
        ? host.readQuery({ query: '{ user { emailThread { id } } }' })
        : host.authority!.current();
    const outcome = pending.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    const request = await started.promise;
    state = { ...state, account: 'viewer', ready: true, policy: 'none' };
    adapter.onmessage?.(
      new MessageEvent('message', {
        data: { kind: 'authority-changed', authority: state },
      })
    );
    adapter.onmessage?.(
      new MessageEvent('message', {
        data: {
          id: request.id,
          ok: true,
          authorityGeneration: initial.generation,
          result:
            reply === 'foreign'
              ? { ...initial, identity: 'other-profile' }
              : reply === 'malformed'
                ? { ...initial, account: 42 }
                : initial,
        },
      })
    );
    if (reply === 'stale') {
      expect(await outcome).toMatchObject({
        value: phase === 'startup' ? { kind: 'hit' } : state,
      });
      expect(host.authority!.snapshot()).toEqual(state);
      expect(failed).not.toHaveBeenCalled();
    } else {
      expect(await outcome).toMatchObject({ error: expect.any(Error) });
      expect(failed).toHaveBeenCalledOnce();
    }
  }
);

it.each(['read', 'read-records-by-keys'] as const)(
  'rejects a delayed %s response after observing a newer authority',
  async (kind) => {
    await host.authority!.current();
    const started = Promise.withResolvers<CacheRequest>();
    const post = adapter.postMessage;
    adapter.postMessage = (request) => {
      if (request.kind === kind) started.resolve(request);
      else post(request);
    };
    const reading =
      kind === 'read'
        ? host.readQuery({ query: '{ user { id } }' })
        : host.readRecordsByKeys({
            keys: [],
            document: 'fragment Item on GraphqlSoupDocument { id }',
            fragmentName: 'Item',
          });
    const request = await started.promise;
    const previous = state.generation;
    state = { ...state, generation: crypto.randomUUID(), ready: true };
    adapter.onmessage?.(
      new MessageEvent<WorkerMessage>('message', {
        data: { kind: 'authority-changed', authority: state },
      })
    );
    const rejected = expect(reading).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    adapter.onmessage?.(
      new MessageEvent<WorkerMessage>('message', {
        data: {
          id: request.id,
          ok: true,
          result: { kind: 'hit', data: { retired: true } },
          authorityGeneration: previous,
        },
      })
    );
    await rejected;
  }
);

it('ignores malformed and foreign authority pushes without throwing from the transport callback', async () => {
  await host.authority!.current();
  const initial = state;
  for (const authority of [
    { ...state, account: 42 },
    { ...state, identity: 'other-profile' },
  ]) {
    expect(() =>
      adapter.onmessage?.(
        new MessageEvent('message', {
          data: { kind: 'authority-changed', authority },
        })
      )
    ).not.toThrow();
    expect(host.authority!.snapshot()).toEqual(initial);
  }
  state = { ...state, generation: crypto.randomUUID() };
  adapter.onmessage?.(
    new MessageEvent<WorkerMessage>('message', {
      data: { kind: 'authority-changed', authority: state },
    })
  );
  expect(host.authority!.snapshot()).toEqual(state);
});

const SCOPE = {
  identity: 'macro|viewer@example.com',
  storageGeneration: '00000000-0000-4000-8000-000000000001',
};
const EPOCH = '00000000-0000-4000-8000-000000000002';
// A caller that omits the stamp despite the types, as older call sites did.
const unstamped = undefined as unknown as string;
it.each([
  ['calendar-commit', () => host.calendarCommit({ reset: true }, unstamped)],
  [
    'people-update',
    () =>
      host.people!.update(
        { scope: SCOPE, epoch: EPOCH, action: { kind: 'commit' } },
        unstamped
      ),
  ],
  [
    'contact-reconcile',
    () =>
      host.people!.reconcile(
        {
          scope: SCOPE,
          fence: EPOCH,
          viewer: SCOPE.identity,
          requested: ['macro|person@example.com'],
          present: [],
        },
        unstamped
      ),
  ],
] as const)(
  'sends an unstamped %s as the unknown generation, never the observed one',
  async (kind, send) => {
    await host.authority!.current();
    await send().catch(() => {});
    const request = requests.find((sent) => sent.kind === kind);
    expect(request?.generation).toBe(UNKNOWN_CACHE_GENERATION);
    expect(request?.generation).not.toBe(state.generation);
  }
);

it('never restamps a pre-ready copied write after the owner becomes ready', async () => {
  await host.writeQuery({
    query: '{ user { id } }',
    data: { user: { id: 'viewer' } },
    generation: UNKNOWN_CACHE_GENERATION,
  });
  const write = requests.find((request) => request.kind === 'write');
  expect(write?.generation).toBe(UNKNOWN_CACHE_GENERATION);
  expect(write?.generation).not.toBe(state.generation);
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
