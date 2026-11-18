import {
  type CacheAuthority,
  type CacheAuthorityHost,
  StaleCacheAuthorityError,
} from '@graphql-cache/authority';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { PEOPLE_POLICY_VERSION } from '@graphql-cache/people/generated';
import type { PeopleCache } from '@graphql-cache/people/host';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { beforeEach, expect, it, vi } from 'vitest';
import { ContactDirectoryScopeError, readContactDirectory } from './directory';

const remote = vi.hoisted(() => vi.fn());
vi.mock('./backfill', () => ({
  loadContactCheckpoint: () => ({ pages: 1, completedAt: 1 }),
}));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: remote,
}));

const VIEWER = 'macro|viewer@example.com';
const OTHER = 'macro|other@example.com';
const INITIAL = '00000000-0000-4000-8000-000000000001';
const FRESH = '00000000-0000-4000-8000-000000000002';
const STORAGE = '00000000-0000-4000-8000-000000000003';
const freshPage = {
  kind: 'page' as const,
  policyVersion: PEOPLE_POLICY_VERSION,
  people: [
    {
      recordKey: 'GraphqlContact:fresh',
      userId: 'macro|person@example.com',
      name: 'Fresh Person',
      email: 'person@example.com',
      lastInteractionMs: 1,
      directMessage: null,
      matchRank: 0,
      score: 0,
      timestampMs: 1,
    },
  ],
  truncated: false,
  nextCursor: null,
};

function localHost(account: string | null = VIEWER) {
  let current: CacheAuthority = {
    identity: 'test-cache',
    generation: INITIAL,
    account,
    policy: null,
    ready: false,
  };
  const listeners = new Set<(value: CacheAuthority) => void>();
  const generationListeners = new Set<
    Parameters<CacheHost['onCacheGenerationChanged']>[0]
  >();
  const authority: CacheAuthorityHost = {
    current: vi.fn(async () => current),
    snapshot: () => current,
    transition: vi.fn(),
    onChanged(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    setReadGuard: vi.fn(),
    verifyRead: vi.fn(),
  };
  const cache = {
    ...createNoopCacheHost(),
    disabled: false,
    authority,
    onCacheGenerationChanged(callback) {
      generationListeners.add(callback);
      return () => generationListeners.delete(callback);
    },
    currentStorageGeneration: vi.fn(async () => STORAGE),
    readQuery: vi
      .fn<CacheHost['readQuery']>()
      .mockResolvedValue({ kind: 'hit', data: { user: { id: VIEWER } } }),
    people: {
      ...unsupportedContactSync,
      readSql: vi.fn(),
      resolveReferences: vi.fn(),
      context: vi.fn(),
      update: vi.fn(),
      search: vi.fn<PeopleCache['search']>().mockResolvedValue(freshPage),
    },
  } satisfies CacheHost;
  const change = (account: string | null) => {
    current = { ...current, generation: FRESH, account };
    for (const listener of listeners) listener(current);
  };
  return { cache, authority, change, listeners, generationListeners };
}

beforeEach(() => {
  remote.mockReset();
  remote.mockImplementation(() => {
    throw new Error('A local contact read must not request the server');
  });
});

it.each([
  ['initial identity', true],
  ['initial identity', false],
  ['people', true],
  ['people', false],
  ['final identity', true],
  ['final identity', false],
] as const)(
  'restarts the whole window after rejected %s, without proof (online=%s)',
  async (phase, online) => {
    const state = localHost(phase === 'initial identity' ? null : VIEWER);
    const rejected = async () => {
      state.change(VIEWER);
      throw new StaleCacheAuthorityError();
    };
    if (phase === 'people') {
      state.cache.people.search.mockImplementationOnce(rejected);
    } else {
      if (phase === 'final identity') {
        state.cache.readQuery.mockResolvedValueOnce({
          kind: 'hit',
          data: { user: { id: VIEWER } },
        });
        state.cache.people.search.mockResolvedValueOnce({
          ...freshPage,
          people: [{ ...freshPage.people[0], name: 'Rejected Person' }],
        });
      }
      state.cache.readQuery.mockImplementationOnce(rejected);
    }
    const page = await readContactDirectory(
      VIEWER,
      state.cache,
      { query: 'person' },
      new AbortController().signal,
      online
    );
    expect(page.users.map((person) => person.name)).toEqual(['Fresh Person']);
    expect(page.source).toBe('cache');
    expect(page.offline).toBe(!online);
    expect(state.authority.current).toHaveBeenCalledTimes(1);
    expect(state.authority.verifyRead).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
    expect(state.listeners.size).toBe(0);
    expect(state.generationListeners.size).toBe(0);
  }
);

it('uses one retry budget for the entire local window', async () => {
  const state = localHost(null);
  state.cache.readQuery.mockImplementationOnce(async () => {
    state.change(VIEWER);
    throw new StaleCacheAuthorityError();
  });
  state.cache.people.search.mockRejectedValue(new StaleCacheAuthorityError());
  await expect(
    readContactDirectory(
      VIEWER,
      state.cache,
      { query: '' },
      new AbortController().signal
    )
  ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
  expect(state.authority.current).toHaveBeenCalledTimes(1);
  expect(state.cache.people.search).toHaveBeenCalledTimes(1);
  expect(remote).not.toHaveBeenCalled();
  expect(state.listeners.size).toBe(0);
});

it.each(['foreign', 'return to viewer', 'unbind', 'storage', 'host'] as const)(
  'does not recover after %s invalidates the account fence',
  async (replacement) => {
    const state = localHost();
    const failure = new StaleCacheAuthorityError();
    state.cache.readQuery.mockImplementationOnce(async () => {
      if (replacement === 'storage') {
        for (const listener of state.generationListeners)
          listener({ storage: 'reset' });
      } else if (replacement === 'host') {
        state.cache.authority = { ...state.authority };
      } else {
        state.change(replacement === 'unbind' ? null : OTHER);
        if (replacement !== 'foreign') state.change(VIEWER);
      }
      throw failure;
    });
    await expect(
      readContactDirectory(
        VIEWER,
        state.cache,
        { query: '' },
        new AbortController().signal
      )
    ).rejects.toBe(failure);
    expect(state.authority.current).not.toHaveBeenCalled();
    expect(state.cache.people.search).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  }
);

it('cancels recovery when a login replacement aborts the window', async () => {
  const state = localHost(null);
  const controller = new AbortController();
  state.cache.readQuery.mockImplementationOnce(async () => {
    state.change(VIEWER);
    throw new StaleCacheAuthorityError();
  });
  vi.spyOn(state.authority, 'current').mockImplementation(async () => {
    controller.abort();
    return {
      identity: 'test-cache',
      generation: FRESH,
      account: VIEWER,
      ready: false,
    };
  });
  await expect(
    readContactDirectory(VIEWER, state.cache, { query: '' }, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.cache.people.search).not.toHaveBeenCalled();
  expect(state.listeners.size).toBe(0);
});

it('does not publish a fresh retry across an account replacement and return', async () => {
  const state = localHost(null);
  state.cache.readQuery.mockImplementationOnce(async () => {
    state.change(VIEWER);
    throw new StaleCacheAuthorityError();
  });
  state.cache.people.search.mockImplementationOnce(async () => {
    state.change(OTHER);
    state.change(VIEWER);
    return freshPage;
  });
  await expect(
    readContactDirectory(
      VIEWER,
      state.cache,
      { query: '' },
      new AbortController().signal
    )
  ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
  expect(state.authority.current).toHaveBeenCalledTimes(1);
  expect(remote).not.toHaveBeenCalled();
});

it('keeps cursor and storage-scope failures distinct from authority recovery', async () => {
  const state = localHost();
  const failure = new ContactDirectoryScopeError();
  state.cache.readQuery.mockRejectedValueOnce(failure);
  await expect(
    readContactDirectory(
      VIEWER,
      state.cache,
      { query: '' },
      new AbortController().signal
    )
  ).rejects.toBe(failure);
  expect(state.authority.current).not.toHaveBeenCalled();
  expect(remote).not.toHaveBeenCalled();
});

it('recovers when the first read starts before the owner snapshot exists', async () => {
  const state = localHost(null);
  vi.spyOn(state.authority, 'snapshot').mockReturnValueOnce(undefined);
  state.cache.readQuery.mockImplementationOnce(async () => {
    state.change(VIEWER);
    throw new StaleCacheAuthorityError();
  });
  const page = await readContactDirectory(
    VIEWER,
    state.cache,
    { query: '' },
    new AbortController().signal
  );
  expect(page.users).toHaveLength(1);
  expect(state.authority.current).toHaveBeenCalledTimes(1);
});

it('does not retry before the owner has bound the expected account', async () => {
  const state = localHost(null);
  const failure = new StaleCacheAuthorityError();
  state.cache.readQuery.mockRejectedValueOnce(failure);
  await expect(
    readContactDirectory(
      VIEWER,
      state.cache,
      { query: '' },
      new AbortController().signal
    )
  ).rejects.toBe(failure);
  expect(state.authority.current).toHaveBeenCalledTimes(1);
  expect(state.cache.readQuery).toHaveBeenCalledTimes(1);
  expect(remote).not.toHaveBeenCalled();
});

it('retains account history while refreshing the owner', async () => {
  const state = localHost(null);
  state.cache.readQuery.mockImplementationOnce(async () => {
    state.change(VIEWER);
    throw new StaleCacheAuthorityError();
  });
  vi.spyOn(state.authority, 'current').mockImplementation(async () => {
    state.change(OTHER);
    state.change(VIEWER);
    return {
      identity: 'test-cache',
      generation: FRESH,
      account: VIEWER,
      ready: false,
    };
  });
  await expect(
    readContactDirectory(
      VIEWER,
      state.cache,
      { query: '' },
      new AbortController().signal
    )
  ).rejects.toBeInstanceOf(StaleCacheAuthorityError);
  expect(state.authority.current).toHaveBeenCalledTimes(1);
  expect(state.cache.people.search).not.toHaveBeenCalled();
  expect(remote).not.toHaveBeenCalled();
});

it('uses the existing bounded fallback only after a fresh local miss', async () => {
  const state = localHost(null);
  state.cache.readQuery.mockImplementationOnce(async () => {
    state.change(VIEWER);
    throw new StaleCacheAuthorityError();
  });
  state.cache.readQuery.mockResolvedValue({ kind: 'miss' });
  remote.mockResolvedValue({
    user: { id: VIEWER, contacts: { nodes: [], nextCursor: null } },
  });
  const page = await readContactDirectory(
    VIEWER,
    state.cache,
    { query: 'person', limit: 7 },
    new AbortController().signal
  );
  expect(page.source).toBe('server');
  expect(remote).toHaveBeenCalledTimes(1);
  expect(remote).toHaveBeenCalledWith(
    { search: 'person', limit: 7, after: null },
    expect.any(AbortSignal)
  );
  expect(state.listeners.size).toBe(0);
  expect(state.generationListeners.size).toBe(0);
});

it('adds no owner or permission request to a successful cached read', async () => {
  const state = localHost();
  await readContactDirectory(
    VIEWER,
    state.cache,
    { query: '' },
    new AbortController().signal,
    false
  );
  expect(state.authority.current).not.toHaveBeenCalled();
  expect(state.authority.verifyRead).not.toHaveBeenCalled();
  expect(remote).not.toHaveBeenCalled();
  expect(state.listeners.size).toBe(0);
  expect(state.generationListeners.size).toBe(0);
});
