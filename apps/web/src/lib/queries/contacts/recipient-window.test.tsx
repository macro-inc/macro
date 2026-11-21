import {
  fetchContactDirectoryByIds,
  fetchContactDirectoryPage,
  fetchContactReferencePage,
} from '@service-storage/graphql-contacts';
import { cleanup, render } from '@solidjs/testing-library';
import {
  hashKey,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { readContactDirectory } from './directory';
import { createContactRecipientSource } from './recipient-window';

vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
  fetchContactReferencePage: vi.fn(),
  fetchContactDirectoryByIds: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('lists pages of a 100k directory below each other up to the bound and releases them on close without truncating late searches', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [includeSelf, setIncludeSelf] = createSignal(false);
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (viewer, _host, request) => {
      const start =
        request.query === 'last'
          ? 99_999
          : request.cursor?.source === 'people'
            ? Number(request.cursor.after)
            : 0;
      const length = Math.min(50, 100_000 - start);
      return {
        query: request.query,
        source: 'cache',
        sync: 'partial',
        offline: false,
        users: Array.from({ length }, (_, index) => ({
          id: `macro|person${start + index}@example.com`,
          email: `person${start + index}@example.com`,
          name: `Person ${start + index}`,
        })),
        nextCursor:
          start + length < 100_000
            ? {
                source: 'people',
                generation: 'fixture',
                after: String(start + length),
                userId: viewer,
                query: request.query,
                policyKey: hashKey([request.policy]),
              }
            : null,
      };
    });
  let source: ReturnType<typeof createContactRecipientSource> | undefined;
  function Harness() {
    source = createContactRecipientSource(
      () => ({ userId: 'macro|viewer@example.com' }),
      {
        search,
        enabled: open,
        selfId: () => 'macro|viewer@example.com',
        senderDomain: () => 'example.com',
        includeSelf,
      },
      () => false,
      reader
    );
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  expect(reader).not.toHaveBeenCalled();
  setOpen(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(source!.items()).toHaveLength(50);
  expect(reader.mock.calls[0][2].policy).toEqual({
    mode: 'recipient',
    excluded: ['macro|viewer@example.com'],
    senderDomain: 'example.com',
  });
  const selected = source!.items()[0];
  for (let page = 1; page < 10; page++) {
    await source!.next();
    await vi.runOnlyPendingTimersAsync();
    expect(source!.items()).toHaveLength((page + 1) * 50);
    expect(source!.items()[0].id).toBe('macro|person0@example.com');
    expect(source!.items()[page * 50].id).toBe(
      `macro|person${page * 50}@example.com`
    );
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  }
  // The listed rows stop at the bound, however far the directory goes.
  expect(source!.hasNext()).toBe(false);
  const reads = reader.mock.calls.length;
  await source!.next();
  expect(reader.mock.calls).toHaveLength(reads);
  expect(new Set(source!.items().map((item) => item.id)).size).toBe(500);
  expect(selected.id).toBe('macro|person0@example.com');
  setOpen(false);
  await vi.runOnlyPendingTimersAsync();
  expect(source!.items()).toEqual([]);
  setOpen(true);
  await vi.runOnlyPendingTimersAsync();
  expect(source!.items()).toHaveLength(50);
  expect(source!.items()[0].id).toBe('macro|person0@example.com');
  setSearch('last');
  expect(source!.items()).toEqual([]);
  await vi.advanceTimersByTimeAsync(200);
  expect(source!.items().map((item) => item.id)).toEqual([
    'macro|person99999@example.com',
  ]);
  expect(source!.hasNext()).toBe(false);
  setIncludeSelf(true);
  await vi.runOnlyPendingTimersAsync();
  expect(reader.mock.calls.at(-1)?.[2].policy?.excluded).toEqual([]);
  setOpen(false);
  await vi.runOnlyPendingTimersAsync();
  expect(source!.items()).toEqual([]);
  expect(
    client
      .getQueryCache()
      .getAll()
      .every((query) => !query.state.data)
  ).toBe(true);
  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  client.clear();
});

it.each(['secondary', 'notifications'])(
  'keeps an empty local continuation after filtering %s addresses',
  async (local) => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const [search, setSearch] = createSignal('');
    const reader = vi
      .fn<typeof readContactDirectory>()
      .mockImplementation(async (viewer, _host, request) => ({
        query: request.query,
        source: 'cache',
        sync: 'unavailable',
        offline: false,
        users: [
          {
            id: `macro|${local}@example.com`,
            email: `${local}@example.com`,
            name: 'Inbox',
          },
        ],
        nextCursor: {
          source: 'people',
          generation: 'fixture',
          after: 'next',
          userId: viewer,
          query: request.query,
          policyKey: hashKey([request.policy]),
        },
      }));
    let source: ReturnType<typeof createContactRecipientSource> | undefined;
    function Harness() {
      source = createContactRecipientSource(
        () => ({ userId: 'viewer' }),
        {
          search,
          enabled: () => true,
          selfId: () => 'viewer',
          senderDomain: () => undefined,
          includeSelf: () => false,
        },
        (id) => id === 'macro|secondary@example.com',
        reader
      );
      return null;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ));
    await vi.advanceTimersByTimeAsync(0);
    expect(source!.items()).toEqual([]);
    expect(source!.hasNext()).toBe(true);
    expect(source!.incomplete()).toBe(true);
    await source!.next();
    expect(reader.mock.calls.at(-1)?.[2].cursor).toMatchObject({
      after: 'next',
    });
    if (local === 'notifications') {
      setSearch('NOTIFICATIONS@example.com');
      await vi.advanceTimersByTimeAsync(200);
      expect(source!.items().map((item) => item.id)).toEqual([
        'macro|notifications@example.com',
      ]);
    }
    client.clear();
  }
);

it('lists a typed address, then a typed teammate, first when a recipient picker reads the server', async () => {
  vi.useFakeTimers();
  const viewer = 'macro|viewer@example.com';
  const contact = (email: string, name: string | null) => ({
    __typename: 'GraphqlContact' as const,
    id: `contact-${email}`,
    userId: `macro|${email}`,
    email,
    name,
  });
  // Loose matches for either search, in contact-ID order; the person typed is
  // further down the directory than the page reaches.
  vi.mocked(fetchContactDirectoryPage).mockResolvedValue({
    user: {
      id: viewer,
      contacts: {
        nodes: [
          contact('compare@example.com', null),
          contact('connect+review@example.com', null),
        ],
        nextCursor: 'next',
      },
    },
  });
  vi.mocked(fetchContactReferencePage).mockResolvedValue({
    user: {
      id: viewer,
      contacts: {
        nodes: [contact('teo.adams@example.com', 'Teo Adams')],
        nextCursor: null,
      },
    },
  });
  const byId = [
    contact('teo.adams@example.com', 'Teo Adams'),
    contact('teo.nys@example.com', 'Teo Nys'),
  ];
  vi.mocked(fetchContactDirectoryByIds).mockImplementation(async (ids) => ({
    user: {
      id: viewer,
      contactsByUserIds: byId.filter((row) => ids.includes(row.userId)),
    },
  }));
  const client = new QueryClient();
  const [search, setSearch] = createSignal('teo.adams@example.com');
  let source: ReturnType<typeof createContactRecipientSource> | undefined;
  function Harness() {
    source = createContactRecipientSource(
      // No cache host: this tab reads the server.
      () => ({ userId: viewer }),
      {
        search,
        enabled: () => true,
        selfId: () => viewer,
        senderDomain: () => undefined,
        includeSelf: () => false,
      },
      () => false,
      undefined,
      () => new Set(['macro|teo.nys@example.com'])
    );
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const emails = () => source?.items().map((item) => item.data.email);
  await vi.advanceTimersByTimeAsync(200);
  expect(emails()).toEqual([
    'teo.adams@example.com',
    'compare@example.com',
    'connect+review@example.com',
  ]);

  // By name, the teammate leads the stranger with the same first name.
  setSearch('teo');
  await vi.advanceTimersByTimeAsync(200);
  expect(emails()).toEqual([
    'teo.nys@example.com',
    'teo.adams@example.com',
    'compare@example.com',
    'connect+review@example.com',
  ]);

  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  client.clear();
});
