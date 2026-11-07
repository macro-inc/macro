import type { CacheHost } from '@graphql-cache/host/types';
import type { PeopleCache } from '@graphql-cache/people/host';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import type { fetchContactDirectoryPage } from '@service-storage/graphql-contacts';
import { CombinedError } from '@urql/core';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  type ContactDirectoryHost,
  ContactDirectoryScopeError,
  readContactDirectory,
} from './directory';

const checkpoint = vi.hoisted(() => vi.fn());
vi.mock('./backfill', () => ({ loadContactCheckpoint: checkpoint }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
}));
const VIEWER = 'macro|viewer@example.com';
const GENERATION = '00000000-0000-4000-8000-000000000001';
const contact = {
  id: 'viewer-scoped-id',
  userId: 'macro|person@example.com',
  email: 'person@example.com',
  name: null,
};
const document = {
  profile: 'quick-access-v1' as const,
  recordKey: 'GraphqlContact:viewer-scoped-id',
  bucket: 'person',
  searchText: 'person@example.com',
  timestampMs: 0,
  sourceHash: 'hash',
};
function host() {
  return {
    clientId: 'host',
    currentStorageGeneration: vi.fn(async () => GENERATION),
    readQuery: vi
      .fn<CacheHost['readQuery']>()
      .mockResolvedValue({ kind: 'hit', data: { user: { id: VIEWER } } }),
    search: vi.fn<CacheHost['search']>().mockResolvedValue({
      projectionVersion: 5,
      documents: [document],
      nextCursor: null,
    }),
    readRecordsByKeys: vi
      .fn<CacheHost['readRecordsByKeys']>()
      .mockResolvedValue({
        revision: INITIAL_CACHE_REVISION,
        records: [{ recordKey: document.recordKey, record: contact }],
      }),
  } satisfies ContactDirectoryHost;
}
const signal = () => new AbortController().signal;
const server = () =>
  vi.fn<typeof fetchContactDirectoryPage>().mockResolvedValue({
    user: { id: VIEWER, contacts: { nodes: [contact], nextCursor: null } },
  });

beforeEach(() => {
  checkpoint.mockReturnValue({ pages: 200, completedAt: 1 });
});

it('reads context-ranked windows with pinned continuations and no unbounded materialization', async () => {
  const base = host();
  const search = vi.fn<PeopleCache['search']>().mockResolvedValue({
    kind: 'page',
    policyVersion: 4,
    people: [
      {
        recordKey: document.recordKey,
        userId: contact.userId,
        name: 'Resolved',
        email: contact.email,
        lastInteractionMs: 0,
        directMessage: null,
        matchRank: 2,
        score: 0.7,
        timestampMs: 0,
      },
    ],
    truncated: true,
    nextCursor: 'ranked-cursor',
  });
  const cache = {
    ...base,
    people: {
      ...unsupportedContactSync,
      readSql: vi
        .fn<PeopleCache['readSql']>()
        .mockResolvedValue({ kind: 'unsupported' }),
      resolveReferences: vi.fn<PeopleCache['resolveReferences']>(),
      search,
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
    },
  };
  const policy = { mode: 'command' as const, excluded: [VIEWER] };
  const fetch = server();
  const page = await readContactDirectory(
    VIEWER,
    cache,
    { query: 'resolved', policy, limit: 7 },
    signal(),
    fetch
  );
  expect(page.users[0]).toEqual({
    id: contact.userId,
    email: contact.email,
    name: 'Resolved',
    lastInteraction: new Date(0),
  });
  expect(page.people?.[0].matchRank).toBe(2);
  expect(base.search).not.toHaveBeenCalled();
  expect(base.readRecordsByKeys).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await readContactDirectory(
    VIEWER,
    cache,
    { query: 'resolved', policy, cursor: page.nextCursor ?? undefined },
    signal(),
    fetch
  );
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({
      cursor: 'ranked-cursor',
      scope: { identity: VIEWER, storageGeneration: GENERATION },
    })
  );
  await expect(
    readContactDirectory(
      VIEWER,
      cache,
      {
        query: 'resolved',
        policy: { ...policy, excluded: [] },
        cursor: page.nextCursor ?? undefined,
      },
      signal(),
      fetch
    )
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  search.mockRejectedValue(new Error('contact search cursor changed'));
  await expect(
    readContactDirectory(
      VIEWER,
      cache,
      { query: 'resolved', policy, cursor: page.nextCursor ?? undefined },
      signal(),
      fetch
    )
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  expect(fetch).not.toHaveBeenCalled();
});

it('uses bounded server fallback when the native policy predates recipient exclusions', async () => {
  const cache = {
    ...host(),
    people: {
      ...unsupportedContactSync,
      readSql: vi
        .fn<PeopleCache['readSql']>()
        .mockResolvedValue({ kind: 'unsupported' }),
      resolveReferences: vi.fn<PeopleCache['resolveReferences']>(),
      search: vi.fn<PeopleCache['search']>().mockResolvedValue({
        kind: 'page',
        policyVersion: 3,
        people: [],
        truncated: false,
        nextCursor: null,
      }),
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
    },
  };
  const fetch = server();
  const page = await readContactDirectory(
    VIEWER,
    cache,
    { query: '', policy: { mode: 'recipient', excluded: [] } },
    signal(),
    fetch
  );
  expect(page.source).toBe('server');
  expect(page.users[0].id).toBe(contact.userId);
  expect(fetch).toHaveBeenCalledOnce();
});

it('keeps unavailable policy fallback source-ordered and preserves empty-page continuation after exclusions', async () => {
  const policy = { mode: 'command' as const, excluded: [contact.userId] };
  const fetch = server().mockResolvedValue({
    user: { id: VIEWER, contacts: { nodes: [contact], nextCursor: 'more' } },
  });
  const page = await readContactDirectory(
    VIEWER,
    host(),
    { query: '', policy },
    signal(),
    fetch
  );
  expect(page.source).toBe('server');
  expect(page.users).toEqual([]);
  expect(page.people).toBeUndefined();
  expect(page.nextCursor?.source).toBe('server');
  await readContactDirectory(
    VIEWER,
    host(),
    { query: '', policy, cursor: page.nextCursor ?? undefined },
    signal(),
    fetch
  );
  expect(fetch).toHaveBeenLastCalledWith(
    expect.objectContaining({ after: 'more' }),
    expect.any(AbortSignal)
  );
});

it('searches and materializes only the bounded window, preserving the target ID and email fallback', async () => {
  const cache = host();
  const fetch = server();
  const result = await readContactDirectory(
    VIEWER,
    cache,
    { query: 'person', limit: 7 },
    signal(),
    fetch
  );
  expect(result).toMatchObject({
    source: 'cache',
    sync: 'snapshot',
    users: [{ id: contact.userId, name: 'person', email: contact.email }],
  });
  expect(cache.search).toHaveBeenCalledWith(
    expect.objectContaining({ buckets: ['person'], query: 'person', limit: 7 })
  );
  expect(cache.readRecordsByKeys).toHaveBeenCalledWith(
    expect.objectContaining({
      keys: [document.recordKey],
      fragmentName: 'ContactDirectoryFields',
    })
  );
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['cold', 'unsupported', 'disabled', 'missing'])(
  'uses one bounded server page for a %s cache',
  async (reason) => {
    const cache = host();
    checkpoint.mockReturnValue({ pages: 0, completedAt: null });
    if (reason === 'unsupported')
      cache.search.mockResolvedValue({ documents: [], nextCursor: null });
    const fetch = server().mockResolvedValue({
      user: { id: VIEWER, contacts: { nodes: [], nextCursor: 'after-budget' } },
    });
    const result = await readContactDirectory(
      VIEWER,
      reason === 'missing'
        ? undefined
        : { ...cache, disabled: reason === 'disabled' },
      { query: 'rare' },
      signal(),
      fetch
    );
    expect(result.users).toEqual([]);
    expect(result.nextCursor).toEqual({
      source: 'server',
      userId: VIEWER,
      query: 'rare',
      after: 'after-budget',
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      { limit: 50, after: null, search: 'rare' },
      expect.any(AbortSignal)
    );
  }
);

it('continues on the server even when local hydration completes between pages', async () => {
  const cache = host();
  const fetch = server();
  await readContactDirectory(
    VIEWER,
    cache,
    {
      query: '',
      cursor: { source: 'server', userId: VIEWER, query: '', after: 'next' },
    },
    signal(),
    fetch
  );
  expect(cache.search).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith(
    expect.objectContaining({ after: 'next' }),
    expect.any(AbortSignal)
  );
});

it('offline partial results never masquerade as a complete or authoritative directory', async () => {
  const cache = host();
  checkpoint.mockReturnValue({ pages: 1, completedAt: null });
  const fetch = server().mockRejectedValue(
    new CombinedError({ networkError: new TypeError('offline') })
  );
  expect(
    await readContactDirectory(VIEWER, cache, { query: '' }, signal(), fetch)
  ).toMatchObject({ offline: true, sync: 'partial', source: 'cache' });
  fetch.mockClear();
  expect(
    await readContactDirectory(
      VIEWER,
      cache,
      { query: '' },
      signal(),
      fetch,
      false
    )
  ).toMatchObject({ offline: true, sync: 'partial' });
  expect(fetch).not.toHaveBeenCalled();
});

it('rechecks the original cache scope after a failed network attempt', async () => {
  const cache = host();
  checkpoint.mockReturnValue({ pages: 1, completedAt: null });
  const fetch = server().mockImplementation(async () => {
    cache.currentStorageGeneration.mockResolvedValue('replacement');
    throw new CombinedError({ networkError: new TypeError('offline') });
  });
  await expect(
    readContactDirectory(VIEWER, cache, { query: '' }, signal(), fetch)
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
});

it('never substitutes cached contacts for an authorization failure', async () => {
  checkpoint.mockReturnValue({ pages: 1, completedAt: null });
  const fetch = server().mockRejectedValue(
    new CombinedError({ graphQLErrors: ['unauthorized'] })
  );
  await expect(
    readContactDirectory(VIEWER, host(), { query: '' }, signal(), fetch)
  ).rejects.toThrow('unauthorized');
});

it('rejects resets during materialization and account/query-mismatched continuations', async () => {
  const cache = host();
  const fetch = server();
  cache.currentStorageGeneration
    .mockResolvedValueOnce(GENERATION)
    .mockResolvedValue('replacement');
  await expect(
    readContactDirectory(VIEWER, cache, { query: '' }, signal(), fetch)
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  expect(fetch).not.toHaveBeenCalled();
  for (const cursor of [
    { source: 'server' as const, userId: 'other', query: '', after: 'next' },
    {
      source: 'server' as const,
      userId: VIEWER,
      query: 'previous',
      after: 'next',
    },
  ])
    await expect(
      readContactDirectory(
        VIEWER,
        cache,
        { query: '', cursor },
        signal(),
        fetch
      )
    ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
});

it('never exposes another cached viewer or accepts another network viewer', async () => {
  const cache = host();
  cache.readQuery.mockResolvedValue({
    kind: 'hit',
    data: { user: { id: 'other' } },
  });
  const fetch = server().mockResolvedValue({
    user: { id: 'other', contacts: { nodes: [contact], nextCursor: null } },
  });
  await expect(
    readContactDirectory(VIEWER, cache, { query: '' }, signal(), fetch)
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  expect(cache.readRecordsByKeys).not.toHaveBeenCalled();
  await expect(
    readContactDirectory(VIEWER, cache, { query: '' }, signal(), fetch, false)
  ).rejects.toThrow('offline');
});

it('does not materialize a superseded search and validates bounds before any IO', async () => {
  const cache = host();
  const fetch = server();
  const controller = new AbortController();
  cache.search.mockImplementation(async () => {
    controller.abort();
    return { projectionVersion: 5, documents: [document], nextCursor: null };
  });
  await expect(
    readContactDirectory(VIEWER, cache, { query: '' }, controller.signal, fetch)
  ).rejects.toThrow();
  expect(cache.readRecordsByKeys).not.toHaveBeenCalled();
  cache.currentStorageGeneration.mockClear();
  for (const request of [
    { query: '', limit: 501 },
    { query: 'x'.repeat(513) },
  ]) {
    await expect(
      readContactDirectory(VIEWER, cache, request, signal(), fetch)
    ).rejects.toThrow('Invalid contact window');
  }
  expect(cache.currentStorageGeneration).not.toHaveBeenCalled();
});
