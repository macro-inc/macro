import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { PeopleCache } from '@graphql-cache/people/host';
import type { fetchContactReferencePage } from '@service-storage/graphql-contacts';
import { CombinedError } from '@urql/core';
import { beforeEach, expect, it, vi } from 'vitest';
import { ContactDirectoryScopeError } from './cache-scope';
import { contactRecordKey } from './contact-key';
import type { resolveContactDirectory } from './lookup';
import {
  type ContactReferenceRequest,
  resolveContactReferences,
} from './references';

const checkpoint = vi.hoisted(() => vi.fn());
vi.mock('./backfill', () => ({ loadContactCheckpoint: checkpoint }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactReferencePage: vi.fn(),
  fetchContactDirectoryPage: vi.fn(),
  fetchContactDirectoryByIds: vi.fn(),
}));
const VIEWER = 'macro|viewer@example.com';
const GENERATION = '00000000-0000-4000-8000-000000000001';
const REQUEST: ContactReferenceRequest = {
  labels: ['Sam'],
  matching: 'preferFullName',
  excludeSecondaryInboxes: false,
};
const signal = () => new AbortController().signal;
const contact = (local: string, name: string | null) => ({
  id: contactRecordKey(VIEWER, `macro|${local}@example.com`).slice(
    'GraphqlContact:'.length
  ),
  userId: `macro|${local}@example.com`,
  email: `${local}@example.com`,
  name,
});
const page = (
  nodes: ReturnType<typeof contact>[],
  nextCursor: string | null = null
) => ({ user: { id: VIEWER, contacts: { nodes, nextCursor } } });
function host() {
  return {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: vi.fn(async () => GENERATION),
    readQuery: vi.fn(async () => ({
      kind: 'hit' as const,
      data: { user: { id: VIEWER } },
    })),
    people: {
      context: vi.fn<PeopleCache['context']>(),
      update: vi.fn<PeopleCache['update']>(),
      search: vi.fn<PeopleCache['search']>(),
      resolveReferences: vi
        .fn<PeopleCache['resolveReferences']>()
        .mockResolvedValue({
          kind: 'resolved',
          policyVersion: 4,
          matches: [
            {
              complete: true,
              people: [
                {
                  userId: 'macro|sam@example.com',
                  email: 'sam@example.com',
                  name: 'Sam',
                },
              ],
            },
          ],
        }),
    },
  };
}
function reads() {
  return {
    page: vi.fn<typeof fetchContactReferencePage>().mockResolvedValue(page([])),
    lookup: vi.fn<typeof resolveContactDirectory>().mockResolvedValue({
      users: [],
      unresolved: [],
      source: 'server',
      offline: false,
    }),
  };
}
beforeEach(() => {
  checkpoint.mockReturnValue({ pages: 200, completedAt: 1 });
});

it('uses complete scoped native evidence without fetching or retaining a directory', async () => {
  const cache = host();
  const network = reads();
  const result = await resolveContactReferences(
    VIEWER,
    cache,
    REQUEST,
    signal(),
    network
  );
  expect(result.source).toBe('cache');
  expect(result.matches[0].people[0].userId).toBe('macro|sam@example.com');
  expect(result.matches[0].complete).toBe(true);
  expect(cache.people.resolveReferences).toHaveBeenCalledWith({
    scope: { identity: VIEWER, storageGeneration: GENERATION },
    labels: ['Sam'],
    matching: 'preferFullName',
    excludeSecondaryInboxes: false,
  });
  expect(network.page).not.toHaveBeenCalled();
  expect(network.lookup).not.toHaveBeenCalled();
});

it('samples completeness before the native scan, never after an intervening hydration completion', async () => {
  checkpoint.mockReturnValue({ pages: 199, completedAt: null });
  const cache = host();
  cache.people.resolveReferences.mockImplementation(async () => {
    checkpoint.mockReturnValue({ pages: 200, completedAt: 1 });
    return {
      kind: 'resolved',
      policyVersion: 4,
      matches: [
        {
          complete: true,
          people: [
            {
              userId: 'macro|sam@example.com',
              email: 'sam@example.com',
              name: 'Sam',
            },
          ],
        },
      ],
    };
  });
  const network = reads();
  const result = await resolveContactReferences(
    VIEWER,
    cache,
    REQUEST,
    signal(),
    network,
    false
  );
  expect(result.matches[0].complete).toBe(false);
  expect(result.native?.completedAt).toBeNull();
  expect(network.page).not.toHaveBeenCalled();
});

it('follows empty exact pages and exhausts the exact pass before calling one match unique', async () => {
  const network = reads();
  network.page
    .mockResolvedValueOnce(page([], 'after-2000'))
    .mockResolvedValueOnce(page([contact('late', 'Sam')], 'after-4000'))
    .mockResolvedValueOnce(page([]));
  const result = await resolveContactReferences(
    VIEWER,
    undefined,
    REQUEST,
    signal(),
    network
  );
  expect(
    network.page.mock.calls.map(([input]) => [
      input.matching,
      input.after,
      input.limit,
    ])
  ).toEqual([
    ['EXACT', null, 500],
    ['EXACT', 'after-2000', 500],
    ['EXACT', 'after-4000', 500],
  ]);
  expect(result.matches[0]).toMatchObject({
    complete: true,
    people: [{ userId: 'macro|late@example.com' }],
  });
});

it('uses first-name fallback only after exact exhaustion and stops at two distinct witnesses', async () => {
  const network = reads();
  network.page
    .mockResolvedValueOnce(page([], 'exact-next'))
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(
      page(
        [
          contact('one', 'Sam One'),
          contact('one', 'Sam One'),
          contact('two', 'Sam Two'),
          contact('three', 'Sam Three'),
        ],
        'not-needed'
      )
    );
  const result = await resolveContactReferences(
    VIEWER,
    undefined,
    REQUEST,
    signal(),
    network
  );
  expect(network.page.mock.calls.map(([input]) => input.matching)).toEqual([
    'EXACT',
    'EXACT',
    'FIRST_NAME',
  ]);
  expect(result.matches[0].people.map((user) => user.userId)).toEqual([
    'macro|one@example.com',
    'macro|two@example.com',
  ]);
  expect(result.matches[0].complete).toBe(true);
});

it('resolves explicit identities separately and does not reinterpret an external address as a display-name alias', async () => {
  const network = reads();
  network.lookup.mockResolvedValue({
    users: [
      { id: 'macro|sam@example.com', email: 'sam@example.com', name: 'Sam' },
    ],
    unresolved: [],
    source: 'server',
    offline: false,
  });
  network.page.mockResolvedValue(
    page([contact('research', 'Research @ Home')])
  );
  const result = await resolveContactReferences(
    VIEWER,
    undefined,
    {
      ...REQUEST,
      labels: [
        'SAM@example.com',
        'macro|sam@example.com',
        'external$@example.com',
        'Research @ Home',
      ],
    },
    signal(),
    network
  );
  expect(network.lookup.mock.calls[0][2]).toEqual({
    kind: 'ids',
    values: ['macro|sam@example.com', 'macro|sam@example.com'],
  });
  expect(network.page).toHaveBeenCalledOnce();
  expect(network.page.mock.calls[0][0].search).toBe('research @ home');
  expect(result.matches.map((entry) => entry.people.length)).toEqual([
    1, 1, 0, 1,
  ]);
});

it('does not treat unknown inbox facts as an authoritative empty exclusion set', async () => {
  const network = reads();
  const result = await resolveContactReferences(
    VIEWER,
    undefined,
    { ...REQUEST, excludeSecondaryInboxes: true },
    signal(),
    network
  );
  expect(result.matches[0].complete).toBe(false);
  expect(network.page).not.toHaveBeenCalled();
  expect(network.lookup).not.toHaveBeenCalled();
});

it('filters fallback inboxes without mistaking a short page for exhaustion', async () => {
  const network = reads();
  network.page
    .mockResolvedValueOnce(page([contact('secondary', 'Sam')], 'next'))
    .mockResolvedValueOnce(page([contact('person', 'Sam')]));
  const result = await resolveContactReferences(
    VIEWER,
    undefined,
    {
      ...REQUEST,
      excludeSecondaryInboxes: true,
      secondaryInboxIds: ['macro|SECONDARY@example.com'],
    },
    signal(),
    network
  );
  expect(result.matches[0].people.map((person) => person.userId)).toEqual([
    'macro|person@example.com',
  ]);
  expect(network.page).toHaveBeenCalledTimes(2);
});

it('never converts authorization failures into offline evidence', async () => {
  checkpoint.mockReturnValue({ pages: 1, completedAt: null });
  const failure = new CombinedError({ graphQLErrors: ['Forbidden'] });
  const network = reads();
  network.page.mockRejectedValue(failure);
  await expect(
    resolveContactReferences(VIEWER, host(), REQUEST, signal(), network)
  ).rejects.toBe(failure);
});

it('keeps offline partial evidence explicitly incomplete and performs no offline HTTP lookups', async () => {
  checkpoint.mockReturnValue({ pages: 1, completedAt: null });
  const network = reads();
  network.page.mockRejectedValue(
    new CombinedError({ networkError: new TypeError('offline') })
  );
  const result = await resolveContactReferences(
    VIEWER,
    host(),
    REQUEST,
    signal(),
    network
  );
  expect(result.offline).toBe(true);
  expect(result.matches[0].complete).toBe(false);
  network.page.mockClear();
  const absent = await resolveContactReferences(
    VIEWER,
    undefined,
    { ...REQUEST, labels: ['Sam', 'sam@example.com'] },
    signal(),
    network,
    false
  );
  expect(absent.matches.every((entry) => !entry.complete)).toBe(true);
  expect(network.page).not.toHaveBeenCalled();
  expect(network.lookup).not.toHaveBeenCalled();
});

it('keeps the exact lookup identity bound distinct from the smaller name-query bound', async () => {
  const id = `macro|${'a'.repeat(600)}@example.com`;
  const network = reads();
  network.lookup.mockResolvedValue({
    users: [{ id, email: id.slice(6), name: 'Legacy identity' }],
    unresolved: [],
    source: 'server',
    offline: false,
  });
  const result = await resolveContactReferences(
    VIEWER,
    undefined,
    { ...REQUEST, labels: [id] },
    signal(),
    network
  );
  expect(result.matches[0].people[0].userId).toBe(id);
  expect(network.page).not.toHaveBeenCalled();
});

it('resolves cached literal identities without claiming a partial directory is complete', async () => {
  checkpoint.mockReturnValue({ pages: 1, completedAt: null });
  const cache = host();
  const network = reads();
  network.lookup.mockResolvedValue({
    users: [
      { id: 'macro|sam@example.com', email: 'sam@example.com', name: 'Sam' },
    ],
    unresolved: [],
    source: 'cache',
    offline: true,
  });
  const result = await resolveContactReferences(
    VIEWER,
    cache,
    { ...REQUEST, labels: ['sam@example.com'] },
    signal(),
    network,
    false
  );
  expect(result.matches[0].complete).toBe(true);
  expect(result.matches[0].people[0].userId).toBe('macro|sam@example.com');
  expect(network.lookup.mock.calls[0][5]).toBe(false);
  expect(cache.people.resolveReferences).not.toHaveBeenCalled();
  expect(network.page).not.toHaveBeenCalled();
});

it('rejects scope changes, foreign records, nonmatching responses and nonadvancing cursors', async () => {
  const cache = host();
  cache.people.resolveReferences.mockImplementation(async () => {
    cache.currentStorageGeneration.mockResolvedValue(
      '00000000-0000-4000-8000-000000000002'
    );
    return {
      kind: 'resolved',
      policyVersion: 4,
      matches: [{ complete: true, people: [] }],
    };
  });
  const network = reads();
  await expect(
    resolveContactReferences(VIEWER, cache, REQUEST, signal(), network)
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  expect(network.page).not.toHaveBeenCalled();
  network.page.mockResolvedValue({
    user: {
      id: 'macro|other@example.com',
      contacts: { nodes: [], nextCursor: null },
    },
  });
  await expect(
    resolveContactReferences(VIEWER, undefined, REQUEST, signal(), network)
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  network.page.mockResolvedValue(
    page([{ ...contact('person', 'Sam'), id: 'wrong-viewer-key' }])
  );
  await expect(
    resolveContactReferences(VIEWER, undefined, REQUEST, signal(), network)
  ).rejects.toBeInstanceOf(ContactDirectoryScopeError);
  network.page.mockResolvedValue(page([contact('person', 'Sam Other')]));
  await expect(
    resolveContactReferences(VIEWER, undefined, REQUEST, signal(), network)
  ).rejects.toThrow('predicate mismatch');
  network.page.mockResolvedValue(page([], 'stuck'));
  await expect(
    resolveContactReferences(VIEWER, undefined, REQUEST, signal(), network)
  ).rejects.toThrow('did not advance');
});

it('rejects oversized raw requests and result pages without deduplication shortcuts', async () => {
  const network = reads();
  await expect(
    resolveContactReferences(
      VIEWER,
      undefined,
      { ...REQUEST, labels: Array(501).fill('Sam') },
      signal(),
      network
    )
  ).rejects.toThrow('Invalid contact reference');
  expect(network.page).not.toHaveBeenCalled();
  await expect(
    resolveContactReferences(
      VIEWER,
      undefined,
      { ...REQUEST, labels: [`${' '.repeat(1024)}sam@example.com`] },
      signal(),
      network
    )
  ).rejects.toThrow('Invalid contact reference');
  network.page.mockResolvedValue(
    page(Array(501).fill(contact('person', 'Sam')))
  );
  await expect(
    resolveContactReferences(VIEWER, undefined, REQUEST, signal(), network)
  ).rejects.toThrow('exceeds its bound');
});
