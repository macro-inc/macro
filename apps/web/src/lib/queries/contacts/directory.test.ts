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
const named = vi.hoisted(() =>
  vi.fn<
    typeof import('@service-storage/graphql-contacts')['fetchContactReferencePage']
  >()
);
const lookedUp = vi.hoisted(() =>
  vi.fn<
    typeof import('@service-storage/graphql-contacts')['fetchContactDirectoryByIds']
  >()
);
vi.mock('./backfill', () => ({ loadContactCheckpoint: checkpoint }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: remote,
  fetchContactReferencePage: named,
  fetchContactDirectoryByIds: lookedUp,
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
function contact(email: string, name: string | null) {
  return {
    __typename: 'GraphqlContact' as const,
    id: `contact-${email}`,
    userId: `macro|${email}`,
    email,
    name,
  };
}
function contactPage(
  nodes: ReturnType<typeof contact>[],
  nextCursor: string | null = null
) {
  return { user: { id: VIEWER, contacts: { nodes, nextCursor } } };
}
beforeEach(() => {
  checkpoint.mockReturnValue({ pages: 200, completedAt: 1 });
  remote.mockReset();
  remote.mockImplementation(() => {
    throw new Error('A usable local cache must answer without the server');
  });
  named.mockReset();
  named.mockResolvedValue(contactPage([]));
  lookedUp.mockReset();
  lookedUp.mockResolvedValue({ user: { id: VIEWER, contactsByUserIds: [] } });
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
it('reads the server once when a budgeted first page gets no answer from the cache in time', async () => {
  vi.useFakeTimers();
  const serverPage = {
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
        ],
        nextCursor: 'server-position',
      },
    },
  };
  remote.mockResolvedValue(serverPage);
  const request = { query: 'jo', localBudgetMs: 2_000 };

  // A cache that never answers: nothing is read from the server before the
  // budget runs out, and one page after it.
  const stalled = host();
  stalled.readQuery.mockReturnValue(new Promise(() => {}));
  const late = readContactDirectory(VIEWER, stalled, request, signal(), true);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(remote).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  const latePage = await late;
  expect(latePage.source).toBe('server');
  expect(latePage.localLate).toBe(true);
  expect(latePage.users.map((user) => user.name)).toEqual(['John Smith']);
  expect(remote).toHaveBeenCalledOnce();

  // Its further pages come from the server too and are marked the same way,
  // so the whole list keeps its place.
  const nextPage = await readContactDirectory(
    VIEWER,
    stalled,
    { ...request, cursor: latePage.nextCursor ?? undefined },
    signal(),
    true
  );
  expect(nextPage.localLate).toBe(true);
  expect(nextPage.nextCursor).toMatchObject({ localLate: true });
  expect(remote).toHaveBeenCalledTimes(2);
  remote.mockClear();
  remote.mockResolvedValue(serverPage);

  // A cache that refuses the read (its owner is changing) is not waited for.
  const refused = host();
  refused.people.search.mockRejectedValue(
    new Error('cache reads unavailable after owner handoff timeout')
  );
  const failedPage = await readContactDirectory(
    VIEWER,
    refused,
    request,
    signal(),
    true
  );
  expect(failedPage.localLate).toBe(true);
  expect(remote).toHaveBeenCalledOnce();

  // A cache that answers in time is the answer; the server is not asked.
  const healthy = await readContactDirectory(
    VIEWER,
    host(),
    request,
    signal(),
    true
  );
  expect(healthy.source).toBe('cache');
  expect(healthy.localLate).toBeUndefined();
  expect(remote).toHaveBeenCalledOnce();

  // A read superseded while it waited asks the server for nothing, and an
  // offline one waits for the cache: it has no server to ask.
  const controller = new AbortController();
  const superseded = readContactDirectory(
    VIEWER,
    stalled,
    request,
    controller.signal,
    true
  );
  const outcome = expect(superseded).rejects.toThrow();
  controller.abort();
  await vi.advanceTimersByTimeAsync(2_000);
  await outcome;
  const slow = host();
  const identity = Promise.withResolvers<{
    kind: 'hit';
    data: { user: { id: string } };
  }>();
  slow.readQuery.mockReturnValueOnce(identity.promise);
  const offline = readContactDirectory(VIEWER, slow, request, signal(), false);
  await vi.advanceTimersByTimeAsync(5_000);
  identity.resolve({ kind: 'hit', data: { user: { id: VIEWER } } });
  expect((await offline).source).toBe('cache');
  expect(remote).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

it('lists the people a typed search names first on a server page, once each', async () => {
  // The server pages by contact ID, so the loosely matching rows come first.
  remote.mockResolvedValue(
    contactPage(
      [
        contact('mateo@example.com', 'Mateo Rossi'),
        contact('stevie@example.com', 'Stevie Leon'),
        contact('teo.nys@example.com', 'Teo Nys'),
        contact('vance@example.com', 'Teodora Vance'),
      ],
      'next'
    )
  );
  named.mockResolvedValue(
    contactPage([
      contact('teo.nys@example.com', 'Teo Nys'),
      contact('teo.park@example.com', 'Teo Park'),
    ])
  );
  const page = await readContactDirectory(
    VIEWER,
    undefined,
    { query: 'teo' },
    signal()
  );
  expect(page.users.map((user) => user.name)).toEqual([
    'Teo Nys',
    'Teo Park',
    'Teodora Vance',
    'Mateo Rossi',
    'Stevie Leon',
  ]);
  // A name on the page that starts with the text is named too, whoever it is.
  expect(page.named).toEqual({
    exact: ['macro|teo.nys@example.com', 'macro|teo.park@example.com'],
    wordStart: ['macro|vance@example.com'],
  });
  expect(named).toHaveBeenCalledExactlyOnceWith(
    { limit: 50, search: 'teo', matching: 'ANY_NAME' },
    expect.anything()
  );

  // Only the first page of typed text asks who it names.
  await readContactDirectory(
    VIEWER,
    undefined,
    { query: 'teo', cursor: page.nextCursor ?? undefined },
    signal()
  );
  const browsed = await readContactDirectory(
    VIEWER,
    undefined,
    { query: '', teammates: ['macro|teo.nys@example.com'] },
    signal()
  );
  await readContactDirectory(VIEWER, undefined, { query: ' \u0085' }, signal());
  expect(browsed.named).toBeUndefined();
  expect(named).toHaveBeenCalledOnce();
  expect(lookedUp).not.toHaveBeenCalled();
});
it('finds the teammates and the whole address a typed search names by ID, wherever they sort in the directory', async () => {
  const teammates = [
    'macro|ana@example.com',
    'macro|sam@example.com',
    'macro|ted@example.com',
    'macro|teo.nys@example.com',
    'macro|zoe@example.com',
  ];
  const directory = [
    contact('ana@example.com', 'Ana Teodoro'),
    contact('sam@example.com', 'Sam Lee'),
    contact('ted@example.com', null),
    contact('teo.nys@example.com', 'Teo Nys'),
    contact('vendor@example.org', 'Vera Vendor'),
    contact('zoe@example.com', 'Zoe Tern'),
  ];
  // The scans end before these people: neither server search returns them.
  remote.mockResolvedValue(
    contactPage([contact('mateo@example.com', 'Mateo Rossi')], 'next')
  );
  lookedUp.mockImplementation(async (ids) => ({
    user: {
      id: VIEWER,
      contactsByUserIds: directory.filter((row) => ids.includes(row.userId)),
    },
  }));
  const read = (query: string, excluded: string[] = []) =>
    readContactDirectory(
      VIEWER,
      undefined,
      {
        query,
        // An ID the server would refuse is never sent.
        teammates: [...teammates, 'bot|00000000-0000-4000-8000-000000000001'],
        policy: { mode: 'mention', excluded },
      },
      signal()
    );

  const partial = await read('te');
  expect(lookedUp).toHaveBeenLastCalledWith(teammates, expect.anything());
  expect(partial.named).toEqual({
    exact: [],
    wordStart: [
      'macro|ana@example.com',
      'macro|ted@example.com',
      'macro|teo.nys@example.com',
      'macro|zoe@example.com',
    ],
  });
  expect(partial.users.map((user) => user.name)).toEqual([
    'Ana Teodoro',
    'ted',
    'Teo Nys',
    'Zoe Tern',
    'Mateo Rossi',
  ]);

  // A whole first name is an exact match; a longer word only starts with it.
  expect((await read('Teo')).named).toEqual({
    exact: ['macro|teo.nys@example.com'],
    wordStart: ['macro|ana@example.com'],
  });
  expect((await read('n teo')).named).toEqual({
    exact: [],
    wordStart: ['macro|teo.nys@example.com'],
  });

  // An address is never a name, so it starts no exact scan. Part of one
  // names the teammates whose address it starts.
  named.mockClear();
  expect((await read('ted@ex')).named).toEqual({
    exact: [],
    wordStart: ['macro|ted@example.com'],
  });
  expect(lookedUp).toHaveBeenLastCalledWith(teammates, expect.anything());

  // A whole address is looked up alone, teammate or not.
  expect((await read('Vendor@Example.org')).named).toEqual({
    exact: ['macro|vendor@example.org'],
    wordStart: [],
  });
  expect(lookedUp).toHaveBeenLastCalledWith(
    ['macro|vendor@example.org'],
    expect.anything()
  );
  expect((await read('teo.nys@example.com')).named).toEqual({
    exact: ['macro|teo.nys@example.com'],
    wordStart: [],
  });
  expect(named).not.toHaveBeenCalled();

  // Punctuation holds no word, so it names nobody; exclusions still apply.
  expect((await read('.')).named).toEqual({ exact: [], wordStart: [] });
  expect(
    (await read('teo', ['macro|teo.nys@example.com'])).users.map(
      (user) => user.name
    )
  ).toEqual(['Ana Teodoro', 'Mateo Rossi']);

  // One lookup asks for at most 500 people.
  await readContactDirectory(
    VIEWER,
    undefined,
    {
      query: 'teo',
      teammates: Array.from(
        { length: 600 },
        (_, index) => `macro|mate${index}@example.com`
      ),
    },
    signal()
  );
  expect(lookedUp.mock.lastCall?.[0]).toHaveLength(500);

  lookedUp.mockResolvedValue({
    user: { id: 'macro|other@example.com', contactsByUserIds: [] },
  });
  await expect(read('teo')).rejects.toBeInstanceOf(ContactDirectoryScopeError);
});
it('still ranks the rows it has when the reads of who the text names fail', async () => {
  remote.mockResolvedValue(
    contactPage([
      contact('mateo@example.com', 'Mateo Rossi'),
      contact('teo.nys@example.com', 'Teo Nys'),
    ])
  );
  named.mockRejectedValue(new Error('exact search timed out'));
  lookedUp.mockRejectedValue(new Error('lookup failed'));
  const page = await readContactDirectory(
    VIEWER,
    undefined,
    { query: 'teo', teammates: ['macro|teo.nys@example.com'] },
    signal()
  );
  // The page's own rows are still read for who the text names.
  expect(page.users.map((user) => user.name)).toEqual([
    'Teo Nys',
    'Mateo Rossi',
  ]);

  // One read failing keeps what the other found.
  lookedUp.mockResolvedValue({
    user: {
      id: VIEWER,
      contactsByUserIds: [contact('teo.zed@example.com', 'Teo Zed')],
    },
  });
  const lookedUpOnly = await readContactDirectory(
    VIEWER,
    undefined,
    { query: 'teo', teammates: ['macro|teo.zed@example.com'] },
    signal()
  );
  expect(lookedUpOnly.users.map((user) => user.name)).toEqual([
    'Teo Zed',
    'Teo Nys',
    'Mateo Rossi',
  ]);
  named.mockResolvedValue(
    contactPage([contact('teo.park@example.com', 'Teo Park')])
  );
  lookedUp.mockRejectedValue(new Error('lookup failed'));
  const exactOnly = await readContactDirectory(
    VIEWER,
    undefined,
    { query: 'teo', teammates: ['macro|teo.zed@example.com'] },
    signal()
  );
  expect(exactOnly.users.map((user) => user.name)).toEqual([
    'Teo Park',
    'Teo Nys',
    'Mateo Rossi',
  ]);

  // An answer past its bound is a failed read, not a longer page.
  lookedUp.mockResolvedValue({
    user: {
      id: VIEWER,
      contactsByUserIds: [
        contact('teo.zed@example.com', 'Teo Zed'),
        contact('teo.yew@example.com', 'Teo Yew'),
      ],
    },
  });
  const oversized = await readContactDirectory(
    VIEWER,
    undefined,
    { query: 'teo', teammates: ['macro|teo.zed@example.com'] },
    signal()
  );
  expect(oversized.users.map((user) => user.name)).toEqual([
    'Teo Park',
    'Teo Nys',
    'Mateo Rossi',
  ]);

  // An answer for another account fails the whole read.
  lookedUp.mockResolvedValue({
    user: { id: 'macro|other@example.com', contactsByUserIds: [] },
  });
  await expect(
    readContactDirectory(
      VIEWER,
      undefined,
      { query: 'teo', teammates: ['macro|teo.zed@example.com'] },
      signal()
    )
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  lookedUp.mockReset();
  named.mockReset();

  // The page itself failing, or the read being cancelled, still fails.
  remote.mockRejectedValue(new Error('denied'));
  await expect(
    readContactDirectory(VIEWER, undefined, { query: 'teo' }, signal())
  ).rejects.toThrow('denied');
  remote.mockResolvedValue(contactPage([]));
  const cancelled = new AbortController();
  named.mockImplementation(async () => {
    cancelled.abort();
    throw new DOMException('Aborted', 'AbortError');
  });
  await expect(
    readContactDirectory(VIEWER, undefined, { query: 'teo' }, cancelled.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
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
