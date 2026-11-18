import type { CacheHost } from '@graphql-cache/host/types';
import {
  PEOPLE_MIN_POLICY_VERSION,
  PEOPLE_POLICY_VERSION,
} from '@graphql-cache/people/generated';
import type { PeopleCache } from '@graphql-cache/people/host';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  type ContactDirectoryHost,
  ContactDirectoryScopeError,
  ContactDirectoryUnavailableError,
  readContactDirectory,
} from './directory';

const checkpoint = vi.hoisted(() => vi.fn());
const remote = vi.hoisted(() =>
  vi.fn<
    typeof import('@service-storage/graphql-contacts')['fetchContactDirectoryPage']
  >(() => {
    throw new Error('A usable local cache must answer without the server');
  })
);
vi.mock('./backfill', () => ({ loadContactCheckpoint: checkpoint }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: remote,
}));
const VIEWER = 'macro|viewer@example.com';
const GENERATION = '00000000-0000-4000-8000-000000000001';
const person = {
  recordKey: 'GraphqlContact:scoped-key',
  userId: 'macro|person@example.com',
  name: 'John Smith',
  email: 'person@example.com',
  lastInteractionMs: 1,
  directMessage: null,
  matchRank: 2,
  score: 0,
  timestampMs: 1,
};
function host() {
  const search = vi.fn<PeopleCache['search']>().mockResolvedValue({
    kind: 'page',
    policyVersion: PEOPLE_POLICY_VERSION,
    people: [person],
    truncated: true,
    nextCursor: 'position',
  });
  return {
    clientId: 'local',
    currentStorageGeneration: vi.fn(async () => GENERATION),
    readQuery: vi
      .fn<CacheHost['readQuery']>()
      .mockResolvedValue({ kind: 'hit', data: { user: { id: VIEWER } } }),
    readRecordsByKeys: vi.fn<CacheHost['readRecordsByKeys']>(),
    people: {
      ...unsupportedContactSync,
      search,
      readSql: vi.fn<PeopleCache['readSql']>(),
      resolveReferences: vi.fn<PeopleCache['resolveReferences']>(),
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
    },
  } satisfies ContactDirectoryHost;
}
const signal = () => new AbortController().signal;
beforeEach(() => {
  checkpoint.mockReturnValue({ pages: 200, completedAt: 1 });
  remote.mockReset();
  remote.mockImplementation(() => {
    throw new Error('A usable local cache must answer without the server');
  });
});

it.each([true, false])(
  'reads and pages only locally (online=%s), preserving native order',
  async (online) => {
    const cache = host();
    const request = { query: 'sm jo', limit: 7 };
    const page = await readContactDirectory(
      VIEWER,
      cache,
      request,
      signal(),
      online
    );
    expect(page.users).toEqual([
      {
        id: person.userId,
        email: person.email,
        name: person.name,
        lastInteraction: new Date(1),
      },
    ]);
    expect(page.source).toBe('cache');
    expect(page.offline).toBe(!online);
    expect(cache.people.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'sm jo',
        limit: 7,
        mode: 'property',
        scope: { identity: VIEWER, storageGeneration: GENERATION },
      })
    );
    await readContactDirectory(
      VIEWER,
      cache,
      { ...request, cursor: page.nextCursor ?? undefined },
      signal(),
      online
    );
    expect(cache.people.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'position' })
    );
    expect(cache.readRecordsByKeys).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  }
);
it('keeps an older native host on its local window down to the policy floor', async () => {
  const cache = host();
  cache.people.search.mockResolvedValue({
    kind: 'page',
    policyVersion: PEOPLE_MIN_POLICY_VERSION,
    people: [person],
    truncated: true,
    nextCursor: 'position',
  });
  const page = await readContactDirectory(
    VIEWER,
    cache,
    { query: 'jo' },
    signal()
  );
  expect(page.source).toBe('cache');
  expect(page.users.map((user) => user.id)).toEqual([person.userId]);
  await readContactDirectory(
    VIEWER,
    cache,
    { query: 'jo', cursor: page.nextCursor ?? undefined },
    signal()
  );
  expect(cache.people.search).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'position' })
  );
  expect(remote).not.toHaveBeenCalled();
});
it.each([
  { pages: 0, completedAt: null },
  { pages: 4, completedAt: null },
])('keeps partial local results during hydration: %j', async (state) => {
  checkpoint.mockReturnValue(state);
  const cache = host();
  const page = await readContactDirectory(
    VIEWER,
    cache,
    { query: '' },
    signal()
  );
  expect(page.sync).toBe('partial');
  expect(page.users).toHaveLength(1);
  expect(remote).not.toHaveBeenCalled();
  cache.people.search.mockResolvedValue({
    kind: 'page',
    policyVersion: PEOPLE_POLICY_VERSION,
    people: [],
    truncated: false,
    nextCursor: null,
  });
  expect(
    (await readContactDirectory(VIEWER, cache, { query: '' }, signal())).sync
  ).toBe(state.pages ? 'partial' : 'cold');
});
it('reads server pages when this tab has no usable local cache', async () => {
  const serverPage = (nextCursor: string | null) => ({
    user: {
      id: VIEWER,
      contacts: {
        nodes: [
          {
            __typename: 'GraphqlContact' as const,
            id: 'contact-1',
            userId: 'macro|person@example.com',
            email: 'person@example.com',
            name: 'John Smith',
          },
          {
            __typename: 'GraphqlContact' as const,
            id: 'contact-2',
            userId: 'macro|excluded@example.com',
            email: 'excluded@example.com',
            name: 'Excluded Person',
          },
        ],
        nextCursor,
      },
    },
  });
  const cache = host();
  const hosts: (ContactDirectoryHost | undefined)[] = [
    undefined,
    { ...cache, disabled: true },
    {
      ...cache,
      readQuery: vi
        .fn<CacheHost['readQuery']>()
        .mockResolvedValue({ kind: 'miss' }),
    },
  ];
  const replies: Awaited<ReturnType<PeopleCache['search']>>[] = [
    { kind: 'unsupported' },
    { kind: 'contextPending' },
    {
      kind: 'page',
      policyVersion: PEOPLE_MIN_POLICY_VERSION - 1,
      people: [],
      truncated: false,
      nextCursor: null,
    },
    {
      kind: 'page',
      policyVersion: PEOPLE_POLICY_VERSION + 1,
      people: [],
      truncated: false,
      nextCursor: null,
    },
  ];
  for (const reply of replies) {
    const unsupported = host();
    unsupported.people.search.mockResolvedValue(reply);
    hosts.push(unsupported);
  }
  const request = {
    query: 'jo',
    limit: 7,
    policy: {
      mode: 'property' as const,
      excluded: ['macro|excluded@example.com'],
    },
  };
  for (const unusable of hosts) {
    remote.mockReset();
    remote.mockResolvedValue(serverPage('next'));
    const page = await readContactDirectory(
      VIEWER,
      unusable,
      request,
      signal()
    );
    expect(page.source).toBe('server');
    expect(page.users).toEqual([
      {
        id: 'macro|person@example.com',
        email: 'person@example.com',
        name: 'John Smith',
      },
    ]);
    expect(remote).toHaveBeenCalledWith(
      { limit: 7, after: null, search: 'jo' },
      expect.anything()
    );

    // A server continuation keeps paging the server while the cache is unusable.
    await readContactDirectory(
      VIEWER,
      unusable,
      { ...request, cursor: page.nextCursor ?? undefined },
      signal()
    );
    expect(remote).toHaveBeenLastCalledWith(
      { limit: 7, after: 'next', search: 'jo' },
      expect.anything()
    );
  }

  // A server continuation stays on the server even once the cache is usable;
  // the window restarts on the cache's change notification instead.
  remote.mockResolvedValue(serverPage('next'));
  const serverWindow = await readContactDirectory(
    VIEWER,
    undefined,
    request,
    signal()
  );
  await readContactDirectory(
    VIEWER,
    cache,
    { ...request, cursor: serverWindow.nextCursor ?? undefined },
    signal()
  );
  expect(cache.people.search).not.toHaveBeenCalled();

  // A local continuation cannot resume on the server's differently ordered pages.
  const localWindow = await readContactDirectory(
    VIEWER,
    cache,
    request,
    signal()
  );
  await expect(
    readContactDirectory(
      VIEWER,
      undefined,
      { ...request, cursor: localWindow.nextCursor ?? undefined },
      signal()
    )
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);

  // Offline, an unusable cache waits for the local cache instead of the server.
  remote.mockClear();
  await expect(
    readContactDirectory(VIEWER, undefined, request, signal(), false)
  ).rejects.toBeInstanceOf(ContactDirectoryUnavailableError);
  expect(remote).not.toHaveBeenCalled();

  // A server page for another account is never shown.
  remote.mockResolvedValue({
    user: {
      id: 'macro|other@example.com',
      contacts: serverPage(null).user.contacts,
    },
  });
  await expect(
    readContactDirectory(VIEWER, undefined, request, signal())
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
});
it('binds continuations to query, policy, account and storage; rejects changed core versions', async () => {
  const cache = host();
  const request = { query: 'john' };
  const first = await readContactDirectory(VIEWER, cache, request, signal());
  const cursor = first.nextCursor ?? undefined;
  for (const changed of [
    { query: 'jane', cursor },
    {
      query: 'john',
      cursor,
      policy: { mode: 'recipient' as const, excluded: [] },
    },
  ])
    await expect(
      readContactDirectory(VIEWER, cache, changed, signal())
    ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  await expect(
    readContactDirectory(
      'macro|other@example.com',
      cache,
      { ...request, cursor },
      signal()
    )
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  cache.currentStorageGeneration.mockResolvedValue(
    '00000000-0000-4000-8000-000000000002'
  );
  await expect(
    readContactDirectory(VIEWER, cache, { ...request, cursor }, signal())
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  cache.currentStorageGeneration.mockResolvedValue(GENERATION);
  cache.people.search.mockRejectedValue(
    new Error('contact search cursor changed')
  );
  await expect(
    readContactDirectory(VIEWER, cache, { ...request, cursor }, signal())
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
});
it('rejects account/reset changes and cancellation during an uninterruptible read', async () => {
  const cache = host();
  const pending =
    Promise.withResolvers<Awaited<ReturnType<PeopleCache['search']>>>();
  cache.people.search.mockReturnValue(pending.promise);
  const started = Promise.withResolvers<void>();
  cache.people.search.mockImplementation(() => {
    started.resolve();
    return pending.promise;
  });
  const result = readContactDirectory(VIEWER, cache, { query: '' }, signal());
  await started.promise;
  cache.currentStorageGeneration.mockResolvedValue(
    '00000000-0000-4000-8000-000000000002'
  );
  pending.resolve({
    kind: 'page',
    policyVersion: PEOPLE_POLICY_VERSION,
    people: [person],
    truncated: false,
    nextCursor: null,
  });
  await expect(result).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  const controller = new AbortController();
  controller.abort();
  await expect(
    readContactDirectory(VIEWER, cache, { query: '' }, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
});
it('does not hide errors or exceed bounded transport input/output', async () => {
  const cache = host();
  cache.people.search.mockRejectedValue(new Error('denied'));
  await expect(
    readContactDirectory(VIEWER, cache, { query: '' }, signal())
  ).rejects.toThrow('denied');
  await expect(
    readContactDirectory(VIEWER, cache, { query: 'x'.repeat(513) }, signal())
  ).rejects.toThrow('Invalid contact window');
  cache.people.search.mockResolvedValue({
    kind: 'page',
    policyVersion: PEOPLE_POLICY_VERSION,
    people: [person, person],
    truncated: false,
    nextCursor: null,
  });
  await expect(
    readContactDirectory(VIEWER, cache, { query: '', limit: 1 }, signal())
  ).rejects.toThrow('Contact response exceeds its window');
  expect(remote).not.toHaveBeenCalled();
});
