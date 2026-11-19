import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retire: vi.fn(),
  refetch: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@queries/auth/user-info', () => ({ fetchUserInfo: vi.fn() }));
vi.mock('./client', () => ({ dssFetch: vi.fn() }));
vi.mock('@queries/client', () => ({
  queryPersistence: { retire: mocks.retire },
  queryClient: { refetchQueries: mocks.refetch, cancelQueries: mocks.cancel },
}));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'document-storage-service': 'http://localhost/dss' },
}));

const TEAM = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  mocks.retire.mockReset().mockResolvedValue(undefined);
  mocks.refetch.mockReset().mockResolvedValue(undefined);
  mocks.cancel.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

const deniedAt = (generation: string, identity: string): CacheAuthority => ({
  identity,
  account: 'viewer',
  generation,
  policy: `${TEAM}:denied`,
  ready: true,
});

type Profile = {
  identity: string;
  /** What a window's owner observation and completed prune leave behind. */
  record(authority: CacheAuthority, pruned?: string): void;
};

/**
 * One page load: fresh modules over the profile's surviving local storage.
 * `meanwhile` runs after the page has read its startup state and before its
 * first owner observation, as another window's work would.
 */
async function start(
  generation: string,
  meanwhile?: (profile: Profile) => void
) {
  vi.resetModules();
  const { installCrmCacheHost, initializeCrmCacheOwner } = await import(
    './crm-access-cache'
  );
  const { cacheSessionGeneration } = await import(
    '@graphql-cache/session-generation'
  );
  const { rememberGeneration, rememberPrunedGeneration } = await import(
    '@graphql-cache/generation-mirror'
  );
  const { getOrCreateCacheScope } = await import('@graphql-cache/scope');
  const profile: Profile = {
    identity: getOrCreateCacheScope(),
    record(authority, pruned) {
      rememberGeneration(authority);
      if (pruned) rememberPrunedGeneration(pruned);
    },
  };
  meanwhile?.(profile);
  const state = deniedAt(generation, profile.identity);
  const authority: CacheAuthorityHost = {
    current: async () => state,
    snapshot: () => state,
    onChanged: () => () => {},
    transition: async () => {
      throw new Error('A start must not commit a proof');
    },
  };
  installCrmCacheHost({
    ...createNoopCacheHost(),
    disabled: false,
    authority,
  });
  await initializeCrmCacheOwner();
  await cacheSessionGeneration.settled();
  // The host's authority observer mirrors every validated observation.
  rememberGeneration(state);
}

it('prunes once for a durable denial and not again on later starts at that generation', async () => {
  const denied = '00000000-0000-4000-8000-000000000002';
  await start(denied);
  expect(mocks.retire).toHaveBeenCalledOnce();

  mocks.retire.mockClear();
  mocks.cancel.mockClear();
  mocks.refetch.mockClear();
  await start(denied);
  expect(mocks.retire).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.refetch).not.toHaveBeenCalled();

  await start('00000000-0000-4000-8000-000000000003');
  expect(mocks.retire).toHaveBeenCalledOnce();
});

it('prunes again on the next start when the earlier prune failed', async () => {
  const denied = '00000000-0000-4000-8000-000000000002';
  mocks.retire.mockRejectedValueOnce(new Error('disk failure'));
  await start(denied);
  expect(mocks.retire).toHaveBeenCalledOnce();

  mocks.retire.mockClear();
  await start(denied);
  expect(mocks.retire).toHaveBeenCalledOnce();
});

it('retires what a start restored when another window recorded the denial during that start', async () => {
  const denied = '00000000-0000-4000-8000-000000000002';
  // This page read its startup state before the denial was recorded.
  await start(denied, (profile) =>
    profile.record(deniedAt(denied, profile.identity), denied)
  );
  expect(mocks.retire).toHaveBeenCalledOnce();
  expect(mocks.cancel).toHaveBeenCalled();
});

it('retires what a start restored when the prune for its denial finished after the start began', async () => {
  const denied = '00000000-0000-4000-8000-000000000002';
  mocks.retire.mockRejectedValueOnce(new Error('disk failure'));
  await start(denied);
  mocks.retire.mockClear();
  // The mirror already names the denial; its prune completes only now.
  await start(denied, (profile) =>
    profile.record(deniedAt(denied, profile.identity), denied)
  );
  expect(mocks.retire).toHaveBeenCalledOnce();
});
