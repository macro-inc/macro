import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCrmAccessAuthority } from '../../service-clients/service-storage/crm-access-authority';
import { type CacheAuthority, StaleCacheAuthorityError } from '../authority';
import { sourceAuthorityGeneration } from '../source-authority';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen,
  emit: vi.fn(async () => {}),
}));

import { createTauriCacheHost } from './tauri-host';

let state: CacheAuthority;
let host: ReturnType<typeof createTauriCacheHost>;
let read: () => Promise<unknown>;
let readAuthority: () => Promise<CacheAuthority>;
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

it('requires fresh proof for protected reads while authored queue inspection stays available offline', async () => {
  await host.authority!.current();
  await expect(host.inspectMutations!()).resolves.toEqual([]);
  await expect(
    host.readQuery({ query: '{ user { emailThread { id } } }' })
  ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
  const proof = vi.fn(async () => {
    await host.authority!.transition(
      (await host.authority!.current()).generation,
      'none'
    );
  });
  host.authority!.setReadGuard(proof);
  for (let index = 0; index < 2; index++)
    await expect(
      host.readQuery({ query: '{ user { emailThread { id } } }' })
    ).resolves.toMatchObject({ kind: 'hit' });
  expect(proof).toHaveBeenCalledTimes(2);
});

it('rejects native content that arrives after another window changes the permission generation', async () => {
  await host.authority!.current();
  host.authority!.setReadGuard(async () => {
    await host.authority!.transition(
      (await host.authority!.current()).generation,
      'none'
    );
  });
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<unknown>();
  read = () => {
    started.resolve();
    return release.promise;
  };
  const pending = host.readQuery({ query: '{ user { emailThread { id } } }' });
  await started.promise;
  state = { ...state, generation: crypto.randomUUID() };
  release.resolve({
    kind: 'hit',
    data: { user: { emailThread: { name: 'old copied content' } } },
  });
  await expect(pending).rejects.toBeInstanceOf(StaleCacheAuthorityError);
});

it('preserves the owner generation when normalizing selected-record revisions', async () => {
  await host.authority!.current();
  await host.authority!.transition(state.generation, 'none');
  const invokeCurrent = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === 'graphql_cache_read_records_by_keys'
      ? Promise.resolve({ revision: '3', records: [] })
      : invokeCurrent(command, args)
  );
  const result = await host.readRecordsByKeys!({
    document: 'fragment Record on GraphqlSoupEmailThread { id }',
    fragmentName: 'Record',
    keys: ['GraphqlSoupEmailThread:thread'],
  });
  expect(result.revision).toBe('3');
  expect(sourceAuthorityGeneration(result)).toBe(state.generation);
});

it('retires the controller synchronously from an owner event while refresh is pending', async () => {
  const policy = '00000000-0000-4000-8000-000000000099:allowed';
  const retire = vi.fn(async () => {});
  const controller = createCrmAccessAuthority({
    fetchProof: async () => policy,
    retire,
  });
  controller.setSession('viewer');
  controller.setHost(host.authority);
  await controller.refresh();
  expect(controller.allowed()).toBe(true);
  retire.mockClear();
  const refresh = Promise.withResolvers<CacheAuthority>();
  readAuthority = () => refresh.promise;
  state = {
    ...state,
    generation: crypto.randomUUID(),
    policy: '00000000-0000-4000-8000-000000000099:denied',
  };

  listeners.get('graphql-cache://authority-changed')!({ payload: state });
  expect(retire).toHaveBeenCalledOnce();
  expect(controller.allowed()).toBe(false);
  expect(host.authority!.snapshot()).toEqual(state);
  refresh.resolve(state);
  await host.authority!.current();
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
  await expect(host.authority!.verifyRead()).resolves.toBeUndefined();
});

it('rejects an old postflight reply as soon as the permission event arrives', async () => {
  await host.authority!.current();
  await host.authority!.transition(state.generation, 'none');
  const old = state;
  const postflightStarted = Promise.withResolvers<void>();
  const oldReply = Promise.withResolvers<CacheAuthority>();
  const freshReply = Promise.withResolvers<CacheAuthority>();
  let requests = 0;
  readAuthority = () => {
    if (++requests === 1) {
      postflightStarted.resolve();
      return oldReply.promise;
    }
    return freshReply.promise;
  };
  const pending = host.readQuery({ query: '{ user { emailThread { id } } }' });
  const rejected = expect(pending).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );
  await postflightStarted.promise;
  state = { ...state, generation: crypto.randomUUID() };
  listeners.get('graphql-cache://authority-changed')!({ payload: state });
  expect(host.authority!.snapshot()).toEqual(state);
  oldReply.resolve(old);
  await rejected;

  freshReply.resolve(state);
  await vi.waitFor(() => expect(host.authority!.snapshot()).toEqual(state));
  await expect(host.authority!.verifyRead()).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );
  await host.authority!.transition(state.generation, 'none');
  await expect(host.authority!.verifyRead()).resolves.toBeUndefined();
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

it('restores verification from a fresh unchanged proof after an authority event', async () => {
  await host.authority!.current();
  await host.authority!.transition(state.generation, 'none');
  const unchanged = state;
  listeners.get('graphql-cache://authority-changed')!({ payload: state });
  expect(host.authority!.snapshot()).toEqual(unchanged);
  await vi.waitFor(() => expect(host.authority!.snapshot()).toEqual(unchanged));
  await expect(host.authority!.verifyRead()).rejects.toBeInstanceOf(
    StaleCacheAuthorityError
  );

  const invokeCurrent = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) =>
    command === 'graphql_cache_transition_authority'
      ? Promise.resolve({
          authority: unchanged,
          revision: '0',
          changed: false,
          affectedOps: [],
        })
      : invokeCurrent(command, args)
  );
  await host.authority!.transition(unchanged.generation, 'none');
  expect(host.authority!.snapshot()?.generation).toBe(unchanged.generation);
  await expect(host.authority!.verifyRead()).resolves.toBeUndefined();
});

it.each(['initialization', 'postflight'] as const)(
  'bounds a stalled %s authority lookup',
  async (stage) => {
    await host.authority!.current();
    host.dispose();
    vi.useFakeTimers();
    if (stage === 'initialization') readAuthority = () => new Promise(() => {});
    host = createTauriCacheHost({
      scope: state.identity,
      requestTimeoutMs: 50,
    });
    if (stage === 'postflight') {
      await host.authority!.current();
      await host.authority!.transition(state.generation, 'none');
      readAuthority = () => new Promise(() => {});
    }
    const pending = host.readQuery({
      query: '{ user { emailThread { id } } }',
    });
    const rejected = expect(pending).rejects.toThrow(
      'graphql cache ipc timeout: graphql_cache_current_authority'
    );
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(60);
    await rejected;
  }
);
