// Three windows of one browser profile: separate module graphs over one shared
// localStorage and one shared persisted-query store.
import type {
  CacheAuthority,
  CacheAuthorityHost,
} from '@graphql-cache/authority';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authKeys } from './auth/keys';
import type { PersistedQueryEntry } from './persistence/per-query-idb';

const profile = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  proof: vi.fn(),
  flushed: Promise.withResolvers<void>(),
  swept: Promise.withResolvers<void>(),
}));
vi.mock('./soup/normalized-cache/normalizer', () => ({
  initSoupNormalizer: () => {},
}));
vi.mock('./persistence-scopes', () => ({
  // Called once per window. Production debounces puts; here they wait for the
  // flush that hiding the page triggers.
  createQueryPersistenceScopes: () => {
    const pending = new Map<string, PersistedQueryEntry>();
    return [
      {
        buster: 'test',
        shouldPersist: () => true,
        store: {
          get: async (hash: string) => profile.disk.get(hash),
          set: (entry: PersistedQueryEntry) =>
            pending.set(entry.queryHash, entry),
          remove: (hash: string) => pending.delete(hash),
          flush: async () => {
            const wrote = pending.size > 0;
            for (const [hash, entry] of pending) profile.disk.set(hash, entry);
            pending.clear();
            if (wrote) profile.flushed.resolve();
          },
          clear: async () => profile.disk.clear(),
          prune: async (keep: (entry: PersistedQueryEntry) => boolean) => {
            for (const [hash, entry] of profile.disk)
              if (!keep(entry as PersistedQueryEntry))
                profile.disk.delete(hash);
            profile.swept.resolve();
          },
        },
      },
    ];
  },
}));
vi.mock('./auth/user-info', () => ({ fetchUserInfo: vi.fn() }));
vi.mock('@service-storage/client', () => ({ dssFetch: profile.proof }));
vi.mock('@core/constant/servers', () => ({
  SERVER_HOSTS: { 'document-storage-service': 'http://localhost/dss' },
}));

const TEAM = '00000000-0000-4000-8000-000000000001';
const CHANNELS = ['channel', 'listChannels', 'viewer'];
const IDENTITY = authKeys.userInfo.queryKey;
const hashOf = (key: readonly unknown[]) => JSON.stringify(key);
const saved = (
  key: readonly unknown[],
  data: unknown
): PersistedQueryEntry => ({
  queryHash: hashOf(key),
  queryKey: key,
  data,
  dataUpdatedAt: Date.now(),
  persistedAt: Date.now(),
  buster: 'test',
});

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  profile.disk.clear();
  profile.flushed = Promise.withResolvers();
  profile.swept = Promise.withResolvers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

/** The shared owner (the cache worker): one durable state, pushed to windows. */
function createSharedOwner() {
  let state: CacheAuthority | undefined;
  const pushes = new Set<(authority: CacheAuthority) => void>();
  return {
    current: () => {
      if (!state) throw new Error('No window has opened the owner');
      return state;
    },
    open(identity: string) {
      state ??= {
        identity,
        account: 'viewer',
        generation: crypto.randomUUID(),
        policy: null,
        ready: false,
      };
    },
    commit(next: CacheAuthority) {
      state = next;
      for (const push of pushes) push(next);
    },
    pushes,
  };
}

type Page = {
  queryClient: { getQueryData(key: readonly unknown[]): unknown };
  queryPersistence: { restoreQuery(key: readonly unknown[]): Promise<void> };
};

async function openWindow(
  owner: ReturnType<typeof createSharedOwner>,
  options: {
    receivesPushes: boolean;
    /** What the page does between loading and its first owner observation. */
    beforeOwner?: (page: Page) => Promise<void>;
  }
) {
  vi.resetModules();
  const { createAuthorityObserver, StaleCacheAuthorityError } = await import(
    '@graphql-cache/authority'
  );
  const { getOrCreateCacheScope } = await import('@graphql-cache/scope');
  const { createNoopCacheHost } = await import('@graphql-cache/host/noop-host');
  const { cacheSessionGeneration } = await import(
    '@graphql-cache/session-generation'
  );
  const { crmAccessAuthority } = await import(
    '@service-storage/crm-access-authority'
  );
  const access = await import('@service-storage/crm-access-cache');
  const { queryClient, queryPersistence } = await import('./client');

  const identity = getOrCreateCacheScope();
  owner.open(identity);
  // The production host's observer mirrors every validated observation.
  const observer = createAuthorityObserver(identity);
  if (options.receivesPushes)
    owner.pushes.add((authority) => observer.observe(authority));
  const authority: CacheAuthorityHost = {
    current: async () => observer.observeCurrent(owner.current()),
    snapshot: observer.snapshot,
    onChanged: observer.onChanged,
    async transition(expected, policy) {
      const before = owner.current();
      if (expected !== before.generation) throw new StaleCacheAuthorityError();
      const changed =
        before.policy !== policy &&
        (before.policy !== null || policy.endsWith(':denied'));
      const next = {
        ...before,
        policy,
        ready: true,
        generation: changed ? crypto.randomUUID() : before.generation,
      };
      owner.commit(next);
      observer.observe(next, undefined, 'transition');
      return {
        authority: next,
        revision: '0',
        affectedOps: [],
        changed: before.policy !== policy,
      };
    },
  };
  await options.beforeOwner?.({ queryClient, queryPersistence });
  access.installCrmCacheHost({
    ...createNoopCacheHost(),
    disabled: false,
    authority,
  });
  await access.initializeCrmCacheOwner();
  access.setCrmAccessSession('viewer');
  await crmAccessAuthority.refresh();
  await cacheSessionGeneration.settled();
  return {
    crmAccessAuthority,
    cacheSessionGeneration,
    queryClient,
    queryPersistence,
  };
}

function hidePage() {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

it('never restores a snapshot another window wrote after the denial was recorded and pruned', async () => {
  const owner = createSharedOwner();
  profile.proof.mockResolvedValue(ok({ team_id: TEAM, allowed: true }));
  const first = await openWindow(owner, { receivesPushes: true });
  // This window goes away before it handles the owner's push.
  const second = await openWindow(owner, { receivesPushes: false });
  expect(second.crmAccessAuthority.state()).toBe('allowed');
  second.queryClient.setQueryData(CHANNELS, { rows: ['seen while allowed'] });
  expect(profile.disk.has(hashOf(CHANNELS))).toBe(false);

  profile.proof.mockResolvedValue(ok({ team_id: TEAM, allowed: false }));
  await first.crmAccessAuthority.refresh();
  await first.cacheSessionGeneration.settled();
  expect(first.crmAccessAuthority.state()).toBe('denied');
  expect(profile.disk.size).toBe(0);

  // Closing or reloading the second window flushes its pending write.
  hidePage();
  await profile.flushed.promise;
  expect(profile.disk.has(hashOf(CHANNELS))).toBe(true);
  profile.disk.set(hashOf(IDENTITY), saved(IDENTITY, { id: 'viewer' }));
  profile.swept = Promise.withResolvers();

  // Every later start under that denial. A mounted query restores as the page
  // loads, before the owner has answered: only the mirror says denied then.
  const later = await openWindow(owner, {
    receivesPushes: true,
    beforeOwner: async (page) => {
      await page.queryPersistence.restoreQuery(CHANNELS);
      expect(page.queryClient.getQueryData(CHANNELS)).toBeUndefined();
    },
  });
  expect(later.crmAccessAuthority.state()).toBe('denied');
  await later.queryPersistence.restoreQuery(CHANNELS);
  expect(later.queryClient.getQueryData(CHANNELS)).toBeUndefined();
  // The start also drops it from disk, and keeps the identity it relaunches on.
  await profile.swept.promise;
  expect(profile.disk.has(hashOf(CHANNELS))).toBe(false);
  await later.queryPersistence.restoreQuery(IDENTITY);
  expect(later.queryClient.getQueryData(IDENTITY)).toEqual({ id: 'viewer' });
  // Three page loads each import the whole query client again.
}, 30_000);
