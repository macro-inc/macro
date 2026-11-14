import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type CacheAuthority, StaleCacheAuthorityError } from '../authority';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));

import { createTauriCacheHost } from './tauri-host';

let state: CacheAuthority;
let host: ReturnType<typeof createTauriCacheHost>;
let read: () => Promise<unknown>;
beforeEach(() => {
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
  invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === 'graphql_cache_current_authority') return state;
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
