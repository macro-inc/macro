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

it('keeps the people still matching typed text until its read lands', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const [search, setSearch] = createSignal('');
  const [viewer, setViewer] = createSignal('macro|viewer@example.com');
  const people = [
    ['Sarah Chen', 'sarah.chen@example.com'],
    ['Sam Lee', 'sam.lee@example.com'],
    ['Omar Kim', 'omar.kim@example.com'],
  ].map(([name, email]) => ({ id: `macro|${email}`, email, name }));
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (request.query === 'fail') throw new Error('read failed');
      return {
        query: request.query,
        source: 'cache',
        sync: 'snapshot',
        offline: false,
        users: people.filter((person) =>
          `${person.name} ${person.email}`
            .toLowerCase()
            .includes(request.query.toLowerCase())
        ),
        nextCursor: null,
      };
    });
  let source: ReturnType<typeof createContactRecipientSource> | undefined;
  function Harness() {
    source = createContactRecipientSource(
      () => ({ userId: viewer() }),
      {
        search,
        enabled: () => true,
        selfId: viewer,
        senderDomain: () => 'example.com',
        includeSelf: () => false,
      },
      () => false,
      reader
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const listed = () => source!.items().map((item) => item.data.name);
  await vi.advanceTimersByTimeAsync(50);
  expect(listed()).toEqual(['Sarah Chen', 'Sam Lee', 'Omar Kim']);

  // Each keystroke narrows the people already listed; none blink out while
  // the read for the new text waits out its debounce.
  setSearch('sa');
  expect(source!.loading()).toBe(true);
  expect(listed()).toEqual(['Sarah Chen', 'Sam Lee']);
  setSearch('sarah.c');
  expect(listed()).toEqual(['Sarah Chen']);
  await vi.advanceTimersByTimeAsync(250);
  expect(source!.loading()).toBe(false);
  expect(listed()).toEqual(['Sarah Chen']);

  // Text no listed person matches empties the list until results land.
  setSearch('omar');
  expect(listed()).toEqual([]);
  await vi.advanceTimersByTimeAsync(250);
  expect(listed()).toEqual(['Omar Kim']);

  // A failed read keeps nothing from the earlier text.
  setSearch('fail');
  await vi.advanceTimersByTimeAsync(250);
  expect(source!.error()).toBeTruthy();
  expect(listed()).toEqual([]);

  // People listed for one account never show for another.
  setSearch('');
  await vi.advanceTimersByTimeAsync(250);
  expect(listed()).toHaveLength(3);
  setViewer('macro|other@example.com');
  expect(listed()).toEqual([]);
  client.clear();
});

it('keeps only the people the read for the typed text can list, from the same cache generation', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const [search, setSearch] = createSignal('');
  let changeGeneration = () => {};
  const host = {
    clientId: 'client',
    onCacheChanged: () => () => {},
    onCacheGenerationChanged: (listener: () => void) => {
      changeGeneration = listener;
      return () => {};
    },
  } as unknown as NonNullable<
    ReturnType<Parameters<typeof createContactRecipientSource>[0]>['host']
  >;
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (_viewer, _host, request) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        query: request.query,
        source: 'cache',
        sync: 'snapshot',
        offline: false,
        users: request.query
          ? []
          : [
              {
                id: 'macro|sam@example.com',
                email: 'sam@example.com',
                name: 'Sam Lee',
              },
            ],
        nextCursor: null,
      };
    });
  let source: ReturnType<typeof createContactRecipientSource> | undefined;
  function Harness() {
    source = createContactRecipientSource(
      () => ({ userId: 'macro|viewer@example.com', host }),
      {
        search,
        enabled: () => true,
        selfId: () => undefined,
        senderDomain: () => undefined,
        includeSelf: () => true,
      },
      () => false,
      reader
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const listed = () => source!.items().map((item) => item.data.name);
  await vi.advanceTimersByTimeAsync(50);
  expect(listed()).toEqual(['Sam Lee']);

  // The cache splits typed text at white space only, so "sam," needs a comma.
  setSearch('sam,');
  expect(listed()).toEqual([]);
  setSearch('');
  await vi.advanceTimersByTimeAsync(250);
  expect(listed()).toEqual(['Sam Lee']);
  setSearch('SAM LEE');
  expect(listed()).toEqual(['Sam Lee']);

  // A new cache generation keeps nobody listed from the one before.
  setSearch('');
  await vi.advanceTimersByTimeAsync(250);
  expect(listed()).toEqual(['Sam Lee']);
  changeGeneration();
  setSearch('sam');
  expect(listed()).toEqual([]);
  client.clear();
});
