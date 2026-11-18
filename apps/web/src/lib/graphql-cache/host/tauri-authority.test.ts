import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type AuthorityTransition,
  type CacheAuthority,
  StaleCacheAuthorityError,
} from '../authority';

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
