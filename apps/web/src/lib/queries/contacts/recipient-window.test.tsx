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

it('replaces pages from a 100k directory and releases them on close without truncating late searches', async () => {
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
          : request.cursor?.source === 'server'
            ? Number(request.cursor.after)
            : 0;
      const length = Math.min(50, 100_000 - start);
      return {
        query: request.query,
        source: 'server',
        sync: 'unavailable',
        offline: false,
        users: Array.from({ length }, (_, index) => ({
          id: `macro|person${start + index}@example.com`,
          email: `person${start + index}@example.com`,
          name: `Person ${start + index}`,
        })),
        nextCursor:
          start + length < 100_000
            ? {
                source: 'server',
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
  for (let page = 1; page <= 20; page++) {
    await source!.next();
    await vi.runOnlyPendingTimersAsync();
    expect(source!.items()).toHaveLength(50);
    expect(source!.items()[0].id).toBe(`macro|person${page * 50}@example.com`);
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  }
  expect(selected.id).toBe('macro|person0@example.com');
  setOpen(false);
  await vi.runOnlyPendingTimersAsync();
  expect(source!.items()).toEqual([]);
  setOpen(true);
  await vi.runOnlyPendingTimersAsync();
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
  'keeps an empty fallback continuation after filtering %s addresses',
  async (local) => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const [search, setSearch] = createSignal('');
    const reader = vi
      .fn<typeof readContactDirectory>()
      .mockImplementation(async (viewer, _host, request) => ({
        query: request.query,
        source: 'server',
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
          source: 'server',
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
