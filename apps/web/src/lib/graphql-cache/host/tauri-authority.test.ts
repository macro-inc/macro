import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type AuthorityTransition,
  type CacheAuthority,
  StaleCacheAuthorityError,
} from '../authority';
import { UNKNOWN_CACHE_GENERATION } from '../generation-mirror';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
const emit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen,
  emit,
}));

import { createTauriCacheHost } from './tauri-host';

let state: CacheAuthority;
let host: ReturnType<typeof createTauriCacheHost>;
let read: () => Promise<unknown>;
let readAuthority: () => Promise<unknown>;
type NativeEventListener = (event: { payload: unknown }) => void;
let listeners: Map<string, NativeEventListener>;
beforeEach(() => {
  vi.clearAllMocks();
  listeners = new Map();
  const registered = listeners;
  listen.mockImplementation(
    async (name: string, callback: NativeEventListener) => {
      registered.set(name, callback);
      return () => {
        if (registered.get(name) === callback) registered.delete(name);
      };
    }
  );
  state = {
    identity: 'native-authority',
    account: 'viewer',
    generation: crypto.randomUUID(),
    policy: null,
    ready: false,
  };
  read = async () => ({
    kind: 'hit',
    data: { user: { emailThread: { id: 'thread' } } },
  });
  readAuthority = async () => state;
  invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === 'graphql_cache_current_authority') return readAuthority();
      if (command === 'graphql_cache_transition_authority') {
        expect(args.expected).toBe(state.generation);
        state = {
          ...state,
          generation: crypto.randomUUID(),
          policy: String(args.policy),
          ready: true,
        };
        return {
          authority: state,
          revision: '0',
          changed: true,
          affectedOps: [],
        };
      }
      if (command === 'graphql_cache_read') return read();
      if (command === 'graphql_cache_inspect_mutations') return [];
      return null;
    }
  );
  host = createTauriCacheHost({ scope: state.identity });
});
afterEach(() => {
  host.dispose();
  vi.useRealTimers();
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
    await host.authority!.current();
    host.dispose();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<unknown>();
    let hold = phase === 'startup';
    let held = false;
    readAuthority = () => {
      if (hold && !held) {
        held = true;
        started.resolve();
        return response.promise;
      }
      return Promise.resolve(state);
    };
    state = { ...state, account: null };
    const initial = state;
    const failed = vi.fn();
    host = createTauriCacheHost({
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
    await started.promise;
    state = { ...state, account: 'viewer', ready: true, policy: 'none' };
    listeners.get('graphql-cache://authority-changed')!({ payload: state });
    response.resolve(
      reply === 'foreign'
        ? { ...initial, identity: 'other-profile' }
        : reply === 'malformed'
          ? { ...initial, account: 42 }
          : initial
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

it('rejects a delayed native read after another window changes authority', async () => {
  await host.authority!.current();
  const started = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<unknown>();
  read = () => {
    started.resolve();
    return reply.promise;
  };
  const reading = host.readQuery({ query: '{ user { emailThread { id } } }' });
  const rejected = expect(reading).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );
  await started.promise;
  state = { ...state, generation: crypto.randomUUID() };
  listeners.get('graphql-cache://authority-changed')!({ payload: state });
  reply.resolve({
    kind: 'hit',
    data: { user: { emailThread: { id: 'retired' } } },
  });
  await rejected;
});

it('keeps a committed hydration broadcast stamped with its original authority', async () => {
  await host.authority!.current();
  const generation = state.generation;
  const started = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<unknown>();
  const invokeBefore = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) => {
    if (command === 'graphql_cache_hydrate') {
      started.resolve();
      return reply.promise;
    }
    return invokeBefore(command, args);
  });
  const hydration = host.hydrateQuery({
    query: '{ user { id } }',
    data: { user: { id: 'viewer' } },
    generation,
  });
  await started.promise;
  state = { ...state, generation: crypto.randomUUID() };
  listeners.get('graphql-cache://authority-changed')!({ payload: state });
  reply.resolve({
    revision: '1',
    revisionAdvanced: true,
    unchangedViews: ['view'],
  });
  await hydration;
  expect(emit).toHaveBeenCalledWith(
    'graphql-cache://cache-hydrated',
    expect.objectContaining({
      authorityGeneration: generation,
      unchangedViews: ['view'],
    })
  );
});

const SCOPE = {
  identity: 'macro|viewer@example.com',
  storageGeneration: '00000000-0000-4000-8000-000000000001',
};
const EPOCH = '00000000-0000-4000-8000-000000000002';
// A caller that omits the stamp despite the types, as older call sites did.
const unstamped = undefined as unknown as string;
it.each([
  [
    'graphql_cache_calendar_commit',
    () => host.calendarCommit({ reset: true }, unstamped),
  ],
  [
    'graphql_cache_people_update',
    () =>
      host.people!.update(
        { scope: SCOPE, epoch: EPOCH, action: { kind: 'commit' } },
        unstamped
      ),
  ],
  [
    'graphql_cache_contact_reconcile',
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
  async (command, send) => {
    await host.authority!.current();
    await send().catch(() => {});
    const sent = invoke.mock.calls.find(([name]) => name === command);
    expect(sent?.[1]).toMatchObject({ generation: UNKNOWN_CACHE_GENERATION });
  }
);

it('never gives a pre-ready copied write the later owner generation', async () => {
  host.dispose();
  const started = Promise.withResolvers<void>();
  const owner = Promise.withResolvers<CacheAuthority>();
  readAuthority = () => {
    started.resolve();
    return owner.promise;
  };
  host = createTauriCacheHost({ scope: state.identity });
  const writing = host.writeQuery({
    query: '{ user { id } }',
    data: { user: { id: 'viewer' } },
    generation: UNKNOWN_CACHE_GENERATION,
  });
  await started.promise;
  expect(
    invoke.mock.calls.some(([command]) => command === 'graphql_cache_write')
  ).toBe(false);
  owner.resolve(state);
  await writing;
  expect(invoke).toHaveBeenCalledWith(
    'graphql_cache_write',
    expect.objectContaining({ generation: UNKNOWN_CACHE_GENERATION })
  );
});

it('reads cached email while the authority has no policy, with one IPC per warm read', async () => {
  await expect(
    host.readQuery({ query: '{ user { emailThread { id } } }' })
  ).resolves.toMatchObject({ kind: 'hit' });
  invoke.mockClear();
  for (let index = 0; index < 10; index++)
    await expect(
      host.readQuery({ query: '{ user { emailThread { id } } }' })
    ).resolves.toMatchObject({ kind: 'hit' });
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(
    Array(10).fill('graphql_cache_read')
  );
});

it.each(['enqueue', 'commit'] as const)(
  'keeps an unknown %s snapshot contentless across initialization',
  async (operation) => {
    host.dispose();
    const owner = Promise.withResolvers<CacheAuthority>();
    readAuthority = () => owner.promise;
    host = createTauriCacheHost({ scope: state.identity });
    const args = {
      generation: UNKNOWN_CACHE_GENERATION,
      query: 'mutation Save { save { id } }',
      data: { save: { id: 'draft' } },
    };
    let writing: Promise<unknown>;
    let command: string;
    if (operation === 'enqueue') {
      command = 'graphql_cache_enqueue_optimistic_mutation';
      writing = host.enqueueOptimisticMutation(
        {
          ...args,
          uuid: crypto.randomUUID(),
        },
        { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 100 }
      );
    } else {
      command = 'graphql_cache_commit_optimistic_write';
      writing = host.commitOptimisticWrite(
        '1',
        { owner: 'runner', generation: '1' },
        args
      );
    }
    owner.resolve(state);
    await writing;
    expect(invoke).toHaveBeenCalledWith(
      command,
      expect.objectContaining({ generation: UNKNOWN_CACHE_GENERATION })
    );
  }
);

it('forwards a captured old generation unchanged for the shared owner to reject', async () => {
  await host.authority!.current();
  const generation = state.generation;
  await host.authority!.transition(generation, 'team:denied');
  invoke.mockClear();
  invoke.mockRejectedValueOnce(
    'cache response belongs to an older session generation'
  );
  await expect(
    host.deleteRecords(['GraphqlSoupDocument:one'], generation)
  ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
  expect(invoke).toHaveBeenCalledWith(
    'graphql_cache_delete_records',
    expect.objectContaining({ generation })
  );
});

it('observes a first account binding from another native window before the next write', async () => {
  await host.authority!.current();
  const generation = crypto.randomUUID();
  state = { ...state, generation, ready: false, policy: null };
  listeners.get('graphql-cache://authority-changed')!({ payload: state });
  expect(host.authority!.snapshot()?.generation).toBe(generation);
  invoke.mockRejectedValueOnce('test stopped after dispatch');
  await expect(
    host.writeQuery({
      query: '{ user { id } }',
      data: { user: { id: 'viewer' } },
      generation,
    })
  ).rejects.toThrow('test stopped');
  expect(invoke).toHaveBeenLastCalledWith(
    'graphql_cache_write',
    expect.objectContaining({ generation })
  );
});

it('ignores authority events belonging to another cache identity', async () => {
  await host.authority!.current();
  await host.authority!.transition(state.generation, 'none');
  const changed = vi.fn();
  host.authority!.onChanged(changed);
  const calls = invoke.mock.calls.length;
  listeners.get('graphql-cache://authority-changed')!({
    payload: {
      ...state,
      identity: 'another-cache',
      generation: crypto.randomUUID(),
    },
  });
  expect(host.authority!.snapshot()).toEqual(state);
  expect(changed).not.toHaveBeenCalled();
  expect(invoke.mock.calls).toHaveLength(calls);
});

it('fails initialization immediately when the authority listener cannot be installed', async () => {
  await host.authority!.current();
  host.dispose();
  const failure = new Error('permission listener unavailable');
  const setupFailed = vi.fn();
  listen.mockImplementation(async (name: string) => {
    if (name === 'graphql-cache://authority-changed') throw failure;
    return () => {};
  });
  host = createTauriCacheHost({
    scope: state.identity,
    onInitializationError: setupFailed,
  });
  await expect(
    host.readQuery({ query: '{ user { emailThread { id } } }' })
  ).rejects.toBe(failure);
  expect(setupFailed).toHaveBeenCalledExactlyOnceWith(failure);
});

it('bounds authority listener setup and releases a listener installed after the deadline', async () => {
  await host.authority!.current();
  host.dispose();
  vi.useFakeTimers();
  const delayed = Promise.withResolvers<() => void>();
  const unlisten = vi.fn();
  const setupFailed = vi.fn();
  listen.mockImplementation((name: string) =>
    name === 'graphql-cache://authority-changed'
      ? delayed.promise
      : Promise.resolve(() => {})
  );
  host = createTauriCacheHost({
    scope: state.identity,
    requestTimeoutMs: 50,
    onInitializationError: setupFailed,
  });
  const rejected = expect(host.authority!.current()).rejects.toThrow(
    'graphql cache ipc timeout: graphql-cache://authority-changed'
  );
  await vi.advanceTimersByTimeAsync(60);
  await rejected;
  expect(setupFailed).toHaveBeenCalledOnce();
  expect(unlisten).not.toHaveBeenCalled();
  delayed.resolve(unlisten);
  await vi.advanceTimersByTimeAsync(0);
  expect(unlisten).toHaveBeenCalledOnce();
});

it('rejects a late transition reply after a newer owner event', async () => {
  await host.authority!.current();
  const invokeCurrent = invoke.getMockImplementation()!;
  const completed = Promise.withResolvers<AuthorityTransition>();
  const release = Promise.withResolvers<void>();
  invoke.mockImplementation(async (command, args) => {
    const result = await invokeCurrent(command, args);
    if (command === 'graphql_cache_transition_authority') {
      completed.resolve(result);
      await release.promise;
    }
    return result;
  });

  const pending = host.authority!.transition(state.generation, 'none');
  const earlier = await completed.promise;
  state = { ...state, generation: crypto.randomUUID(), policy: 'denied' };
  listeners.get('graphql-cache://authority-changed')!({ payload: state });
  expect(host.authority!.snapshot()).toEqual(state);
  expect(state.generation).not.toBe(earlier.authority.generation);

  const rejected = expect(pending).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );
  release.resolve();
  await rejected;
  expect(host.authority!.snapshot()).toEqual(state);
});
