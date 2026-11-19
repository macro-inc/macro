import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retire: vi.fn(),
  sweep: vi.fn(),
  refetch: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@queries/auth/user-info', () => ({ fetchUserInfo: vi.fn() }));
vi.mock('./client', () => ({ dssFetch: vi.fn() }));
vi.mock('@queries/client', () => ({
  queryPersistence: { retire: mocks.retire, pruneExcluded: mocks.sweep },
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
  mocks.sweep.mockReset().mockResolvedValue(undefined);
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
  /** What another window's owner observation leaves in the shared mirror. */
  record(authority: CacheAuthority): void;
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
  const { rememberGeneration } = await import(
    '@graphql-cache/generation-mirror'
  );
  const { getOrCreateCacheScope } = await import('@graphql-cache/scope');
  const profile: Profile = {
    identity: getOrCreateCacheScope(),
    record: rememberGeneration,
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

it('retires once for a durable denial and only sweeps the disk on later starts under it', async () => {
  const denied = '00000000-0000-4000-8000-000000000002';
  await start(denied);
  expect(mocks.retire).toHaveBeenCalledOnce();
  expect(mocks.sweep).not.toHaveBeenCalled();

  mocks.retire.mockClear();
  mocks.cancel.mockClear();
  mocks.refetch.mockClear();
  await start(denied);
  expect(mocks.retire).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.refetch).not.toHaveBeenCalled();
  expect(mocks.sweep).toHaveBeenCalledOnce();

  mocks.sweep.mockClear();
  await start('00000000-0000-4000-8000-000000000003');
  expect(mocks.retire).toHaveBeenCalledOnce();
  expect(mocks.sweep).not.toHaveBeenCalled();
});

it('sweeps the disk on the next start when the first prune failed', async () => {
  const denied = '00000000-0000-4000-8000-000000000002';
  mocks.retire.mockRejectedValueOnce(new Error('disk failure'));
  await start(denied);
  expect(mocks.retire).toHaveBeenCalledOnce();

  mocks.retire.mockClear();
  await start(denied);
  // Nothing is restored while denied, so only the disk is owed a cleanup.
  expect(mocks.retire).not.toHaveBeenCalled();
  expect(mocks.sweep).toHaveBeenCalledOnce();
});

it('retires what a start restored when another window recorded the denial during that start', async () => {
  const denied = '00000000-0000-4000-8000-000000000002';
  // This page read its startup state before the denial was recorded.
  await start(denied, (profile) =>
    profile.record(deniedAt(denied, profile.identity))
  );
  expect(mocks.retire).toHaveBeenCalledOnce();
  expect(mocks.cancel).toHaveBeenCalled();
  expect(mocks.sweep).not.toHaveBeenCalled();
});
