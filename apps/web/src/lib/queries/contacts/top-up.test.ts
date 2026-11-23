import type { CacheHost } from '@graphql-cache/host/types';
import { createPeopleCache } from '@graphql-cache/people/host';
import { unsupportedPeopleTransport } from '@graphql-cache/people/test-support';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import {
  fetchContactDirectoryByIds,
  type hydrateGraphqlContacts,
} from '@service-storage/graphql-contacts';
import { render } from '@solidjs/testing-library';
import * as Effect from 'effect/Effect';
import { beforeEach, expect, it, vi } from 'vitest';
import { runContactBackfill } from './backfill';
import { contactRecordKey } from './contact-key';
import type { ContactLookupHost } from './lookup';
import { contactRefreshRevision, handleContactsInvalidation } from './refresh';
import { topUpContacts, useContactTopUp } from './top-up';

vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryByIds: vi.fn(),
  fetchContactDirectoryPage: vi.fn(),
  hydrateGraphqlContacts: vi.fn(),
}));
vi.mock('../auth/use-query-account', () => ({
  useQueryAccount: () => () => ({ userId: VIEWER, session: 0 }),
}));

const VIEWER = 'macro|viewer@example.com';
const PERSON = 'macro|person@example.com';
const GENERATION = '00000000-0000-4000-8000-000000000001';

function contact(userId: string) {
  return {
    id: contactRecordKey(VIEWER, userId).slice('GraphqlContact:'.length),
    userId,
    email: userId.slice('macro|'.length),
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
      .mockResolvedValue({ revision: INITIAL_CACHE_REVISION, records: [] }),
    search: vi.fn(async () => ({
      projectionVersion: 5,
      documents: [],
      nextCursor: null,
    })),
    hydrateQuery: vi.fn<CacheHost['hydrateQuery']>().mockResolvedValue({
      kind: 'void',
      revision: INITIAL_CACHE_REVISION,
    }),
  } satisfies ContactLookupHost;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchContactDirectoryByIds).mockReset();
});

it('stores the contacts an invalidation names, under the contact write scope', async () => {
  const cache = host();
  const persisted = Promise.withResolvers<void>();
  cache.hydrateQuery.mockImplementation(async () => {
    persisted.resolve();
    return { kind: 'void', revision: INITIAL_CACHE_REVISION };
  });
  vi.mocked(fetchContactDirectoryByIds).mockResolvedValue({
    user: { id: VIEWER, contactsByUserIds: [contact(PERSON)] },
  });
  const mounted = render(() => {
    useContactTopUp(
      () => VIEWER,
      () => cache,
      () => 0
    );
    return null;
  });
  const revision = contactRefreshRevision();

  handleContactsInvalidation({ changed: [PERSON] }, undefined);
  await persisted.promise;

  expect(fetchContactDirectoryByIds).toHaveBeenCalledExactlyOnceWith(
    [PERSON],
    expect.any(AbortSignal),
    { lists: false }
  );
  expect(cache.hydrateQuery).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      operationName: 'ContactDirectoryByUserIds',
      data: { user: { id: VIEWER, contactsByUserIds: [contact(PERSON)] } },
      hydrationScope: {
        identity: VIEWER,
        storageGeneration: GENERATION,
        contactFence: GENERATION,
      },
    })
  );
  // The scan still runs on its usual cadence, and still handles removals.
  expect(contactRefreshRevision()).toBe(revision + 1);
  mounted.unmount();
});

it('only schedules the scan when an invalidation names no contacts', () => {
  const cache = host();
  const mounted = render(() => {
    useContactTopUp(
      () => VIEWER,
      () => cache,
      () => 0
    );
    return null;
  });
  const revision = contactRefreshRevision();

  handleContactsInvalidation({}, undefined);
  handleContactsInvalidation({ changed: [] }, undefined);
  handleContactsInvalidation(undefined, undefined);

  expect(contactRefreshRevision()).toBe(revision + 3);
  expect(fetchContactDirectoryByIds).not.toHaveBeenCalled();
  mounted.unmount();
});

it('waits for an in-flight scan page before reading or writing', async () => {
  const cache = host();
  const pageStarted = Promise.withResolvers<void>();
  const page =
    Promise.withResolvers<Awaited<ReturnType<typeof hydrateGraphqlContacts>>>();
  const fetchPage = vi.fn<typeof hydrateGraphqlContacts>(async () => {
    pageStarted.resolve();
    return page.promise;
  });
  const fetchIds = vi
    .fn<typeof fetchContactDirectoryByIds>()
    .mockResolvedValue({
      user: { id: VIEWER, contactsByUserIds: [contact(PERSON)] },
    });
  const scan = Effect.runPromise(
    runContactBackfill(VIEWER, cache, {
      fetchPage,
      reconcilePage: async () => ({ nextCursor: null, incomplete: false }),
      pageDelayMs: 0,
    })
  );
  await pageStarted.promise;

  const topUp = topUpContacts(
    VIEWER,
    cache,
    [PERSON],
    new AbortController().signal,
    fetchIds
  );
  // Drain every runnable continuation: a top-up that did not wait for the
  // scan page would have reached its lookup by now.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchIds).not.toHaveBeenCalled();

  page.resolve({
    user: { id: VIEWER, contacts: { nextCursor: null } },
  });
  await Promise.all([scan, topUp]);
  expect(fetchIds).toHaveBeenCalledOnce();
  expect(cache.hydrateQuery).toHaveBeenCalledOnce();
});

it('releases its turn when the lookup fails, so the next scan page runs', async () => {
  const cache = host();
  const fetchIds = vi
    .fn<typeof fetchContactDirectoryByIds>()
    .mockRejectedValue(new Error('server unavailable'));
  const fetchPage = vi.fn<typeof hydrateGraphqlContacts>().mockResolvedValue({
    user: { id: VIEWER, contacts: { nextCursor: null } },
  });

  await topUpContacts(
    VIEWER,
    cache,
    [PERSON],
    new AbortController().signal,
    fetchIds
  );
  await Effect.runPromise(
    runContactBackfill(VIEWER, cache, {
      fetchPage,
      reconcilePage: async () => ({ nextCursor: null, incomplete: false }),
      pageDelayMs: 0,
    })
  );

  expect(fetchIds).toHaveBeenCalledOnce();
  expect(fetchPage).toHaveBeenCalledOnce();
});

it('stops topping up once the tab no longer runs the contact sync', () => {
  const cache = host();
  const mounted = render(() => {
    useContactTopUp(
      () => VIEWER,
      () => cache,
      () => 0
    );
    return null;
  });
  mounted.unmount();

  handleContactsInvalidation({ changed: [PERSON] }, undefined);

  expect(fetchContactDirectoryByIds).not.toHaveBeenCalled();
});

it('makes no lookup on a host that cannot store contacts', async () => {
  const cache = { ...host(), people: undefined };
  const fetchIds = vi.fn<typeof fetchContactDirectoryByIds>();

  await topUpContacts(
    VIEWER,
    cache,
    [PERSON],
    new AbortController().signal,
    fetchIds
  );

  expect(fetchIds).not.toHaveBeenCalled();
  expect(cache.hydrateQuery).not.toHaveBeenCalled();
});
