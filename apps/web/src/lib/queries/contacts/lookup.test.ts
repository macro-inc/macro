import type { CacheHost } from '@graphql-cache/host/types';
import { createPeopleCache } from '@graphql-cache/people/host';
import { unsupportedPeopleTransport } from '@graphql-cache/people/test-support';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import type { fetchContactDirectoryByIds } from '@service-storage/graphql-contacts';
import { CombinedError } from '@urql/core';
import { expect, it, vi } from 'vitest';
import { ContactDirectoryScopeError } from './cache-scope';
import { contactRecordKey } from './contact-key';
import {
  type ContactLookupHost,
  contactLookupIds,
  resolveContactDirectory,
} from './lookup';

vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryByIds: vi.fn(),
  fetchContactDirectoryPage: vi.fn(),
}));
const VIEWER = 'macro|viewer@example.com';
const PERSON = 'macro|person@example.com';
const OTHER = 'macro|other@example.com';
const GENERATION = '00000000-0000-4000-8000-000000000001';
const signal = () => new AbortController().signal;
function contact(userId: string) {
  return {
    id: contactRecordKey(VIEWER, userId).slice('GraphqlContact:'.length),
    userId,
    email: userId.slice(6),
    name: 'Person',
  };
}
function host() {
  return {
    clientId: 'fixture',
    people: createPeopleCache({
      ...unsupportedPeopleTransport,
      snapshot: async () => ({
        fence: GENERATION,
        ids: [],
        nextCursor: null,
        incomplete: false,
      }),
    }),
    currentStorageGeneration: vi.fn(async () => GENERATION),
    readQuery: vi
      .fn<CacheHost['readQuery']>()
      .mockResolvedValue({ kind: 'hit', data: { user: { id: VIEWER } } }),
    readRecordsByKeys: vi
      .fn<CacheHost['readRecordsByKeys']>()
      .mockResolvedValue({
        revision: INITIAL_CACHE_REVISION,
        records: [
          {
            recordKey: contactRecordKey(VIEWER, PERSON),
            record: contact(PERSON),
          },
        ],
      }),
  } satisfies ContactLookupHost;
}
const server = () =>
  vi.fn<typeof fetchContactDirectoryByIds>().mockResolvedValue({
    user: { id: VIEWER, contactsByUserIds: [contact(PERSON)] },
  });

it('uses only viewer-scoped point reads offline and leaves absent selections unresolved', async () => {
  const cache = host();
  const fetch = server();
  const result = await resolveContactDirectory(
    VIEWER,
    cache,
    {
      kind: 'emails',
      values: ['OTHER@example.com', 'PERSON@example.com', 'person@example.com'],
    },
    signal(),
    fetch,
    false
  );
  expect(cache.readRecordsByKeys).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      keys: [contactRecordKey(VIEWER, OTHER), contactRecordKey(VIEWER, PERSON)],
    })
  );
  expect(result).toMatchObject({
    users: [{ id: PERSON, name: 'Person' }],
    unresolved: [OTHER],
    source: 'cache',
    offline: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});

it('bounds raw input before deduplication and empty input performs no IO', async () => {
  const cache = host();
  const fetch = server();
  expect(
    contactLookupIds({
      kind: 'ids',
      values: ['macro|PERSON@example.com', PERSON],
    })
  ).toEqual([PERSON]);
  await expect(
    resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'ids', values: Array(501).fill(PERSON) },
      signal(),
      fetch
    )
  ).rejects.toThrow('bound');
  expect(
    await resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'emails', values: [] },
      signal(),
      fetch
    )
  ).toMatchObject({ users: [], unresolved: [], source: 'empty' });
  expect(cache.currentStorageGeneration).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('uses authoritative online omissions instead of resurrecting cached membership', async () => {
  const fetch = server().mockResolvedValue({
    user: { id: VIEWER, contactsByUserIds: [] },
  });
  expect(
    await resolveContactDirectory(
      VIEWER,
      host(),
      { kind: 'ids', values: [PERSON] },
      signal(),
      fetch
    )
  ).toMatchObject({
    users: [],
    unresolved: [PERSON],
    source: 'server',
    offline: false,
  });
});

it('preserves requested ordering and warms only the bounded lookup under its original scope', async () => {
  const cache = {
    ...host(),
    search: vi.fn<CacheHost['search']>().mockResolvedValue({
      projectionVersion: 5,
      documents: [],
      nextCursor: null,
    }),
    hydrateQuery: vi.fn<CacheHost['hydrateQuery']>().mockResolvedValue({
      kind: 'data',
      data: {},
      revision: INITIAL_CACHE_REVISION,
    }),
  };
  const fetch = server().mockResolvedValue({
    user: { id: VIEWER, contactsByUserIds: [contact(PERSON), contact(OTHER)] },
  });
  const result = await resolveContactDirectory(
    VIEWER,
    cache,
    { kind: 'ids', values: [OTHER, PERSON] },
    signal(),
    fetch
  );
  expect(result.users.map((user) => user.id)).toEqual([OTHER, PERSON]);
  expect(cache.hydrateQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      hydrationScope: {
        identity: VIEWER,
        storageGeneration: GENERATION,
        contactFence: GENERATION,
      },
      variables: { userIds: [OTHER, PERSON] },
    })
  );
  cache.hydrateQuery.mockRejectedValue(
    new Error('cache hydration scope changed')
  );
  await expect(
    resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'ids', values: [OTHER, PERSON] },
      signal(),
      fetch
    )
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
});

it('only transport failures allow cached fallback, and that fallback rechecks scope', async () => {
  const cache = host();
  const fetch = server().mockRejectedValue(
    new CombinedError({ networkError: new Error('offline') })
  );
  expect(
    await resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'ids', values: [PERSON] },
      signal(),
      fetch
    )
  ).toMatchObject({ source: 'cache', offline: true });
  fetch.mockRejectedValue(
    new CombinedError({ graphQLErrors: ['unauthorized'] })
  );
  await expect(
    resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'ids', values: [PERSON] },
      signal(),
      fetch
    )
  ).rejects.toThrow('unauthorized');
  fetch.mockImplementation(async () => {
    cache.currentStorageGeneration.mockResolvedValue('replacement');
    throw new CombinedError({ networkError: new Error('offline') });
  });
  await expect(
    resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'ids', values: [PERSON] },
      signal(),
      fetch
    )
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
});

it('refuses another viewer and discards mis-keyed cached rows', async () => {
  const cache = host();
  cache.readRecordsByKeys.mockResolvedValue({
    revision: INITIAL_CACHE_REVISION,
    records: [
      { recordKey: contactRecordKey(VIEWER, PERSON), record: contact(OTHER) },
    ],
  });
  expect(
    await resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'ids', values: [PERSON] },
      signal(),
      server(),
      false
    )
  ).toMatchObject({ users: [], unresolved: [PERSON] });
  const fetch = server().mockResolvedValue({
    user: { id: OTHER, contactsByUserIds: [contact(PERSON)] },
  });
  await expect(
    resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'ids', values: [PERSON] },
      signal(),
      fetch
    )
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  cache.readQuery.mockResolvedValue({
    kind: 'hit',
    data: { user: { id: OTHER } },
  });
  await expect(
    resolveContactDirectory(
      VIEWER,
      cache,
      { kind: 'ids', values: [PERSON] },
      signal(),
      fetch,
      false
    )
  ).rejects.toThrow('offline');
});
