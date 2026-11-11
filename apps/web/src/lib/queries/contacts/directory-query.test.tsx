import { render } from '@solidjs/testing-library';
import {
  hashKey,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type ContactDirectoryPage,
  ContactDirectoryScopeError,
  type readContactDirectory,
} from './directory';
import { createContactDirectoryWindow } from './directory-query';

vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
}));
const result = (viewer: string, query: string): ContactDirectoryPage => ({
  source: 'cache',
  sync: 'snapshot',
  offline: false,
  query,
  nextCursor: null,
  users: [{ id: viewer, email: 'person@example.com', name: query || 'Person' }],
});
afterEach(() => {
  vi.useRealTimers();
});

it('keeps one result window and removes query history after replacement and disposal', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (viewer, _host, request) =>
      result(viewer, request.query)
    );
  let committed = Promise.withResolvers<ContactDirectoryPage>();
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  function Harness() {
    const directory = createContactDirectoryWindow(
      () => ({ userId: 'viewer' }),
      reader
    );
    window = directory;
    createEffect(() => {
      const data = directory.data();
      if (data) committed.resolve(data);
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  await committed.promise;
  for (let i = 0; i < 20; i++) {
    committed = Promise.withResolvers<ContactDirectoryPage>();
    window!.setSearch(`query-${i}`);
    await vi.advanceTimersByTimeAsync(200);
    expect((await committed.promise).query).toBe(`query-${i}`);
    await vi.runOnlyPendingTimersAsync();
    expect(client.getQueryCache().getAll()).toHaveLength(1);
    expect(window!.data()?.users).toHaveLength(1);
  }
  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  client.clear();
});

it('accepts external menu queries and resets ranked continuation when policy changes', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const [search, setSearch] = createSignal('first');
  const [excluded, setExcluded] = createSignal<string[]>([]);
  let committed = Promise.withResolvers<void>();
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (user, _host, request) => ({
      ...result(user, request.query),
      nextCursor: {
        source: 'people',
        userId: user,
        query: request.query,
        generation: 'generation',
        after: 'rank-position',
        policyKey: hashKey([request.policy]),
      },
    }));
  function Harness() {
    const directory = createContactDirectoryWindow(
      () => ({ userId: 'viewer' }),
      reader,
      () => true,
      {
        search,
        policy: () => ({ mode: 'command', excluded: excluded() }),
      }
    );
    window = directory;
    createEffect(() => {
      if (directory.data()) committed.resolve();
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(200);
  await committed.promise;
  committed = Promise.withResolvers<void>();
  window!.next();
  await vi.runOnlyPendingTimersAsync();
  await committed.promise;
  expect(reader.mock.calls.at(-1)?.[2].cursor?.source).toBe('people');
  committed = Promise.withResolvers<void>();
  setExcluded(['viewer']);
  await vi.runOnlyPendingTimersAsync();
  await committed.promise;
  expect(reader.mock.calls.at(-1)?.[2].cursor).toBeUndefined();
  committed = Promise.withResolvers<void>();
  setSearch('next');
  await vi.advanceTimersByTimeAsync(200);
  await committed.promise;
  expect(reader.mock.calls.at(-1)?.[2].query).toBe('next');
  await vi.runOnlyPendingTimersAsync();
  expect(client.getQueryCache().getAll()).toHaveLength(1);
  mounted.unmount();
  client.clear();
});

it('snapshots continuation values instead of retaining reactive previous-page proxies', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  let committed = Promise.withResolvers<void>();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (viewer, _host, request) => {
      const index =
        request.cursor?.source === 'people' ? Number(request.cursor.after) : 0;
      return {
        ...result(viewer, ''),
        nextCursor: {
          source: 'people',
          generation: 'fixture',
          policyKey: '',
          userId: viewer,
          query: '',
          after: String(index + 1),
        },
      };
    });
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  function Harness() {
    const directory = createContactDirectoryWindow(
      () => ({ userId: 'viewer' }),
      reader
    );
    window = directory;
    createEffect(() => {
      if (directory.data()) committed.resolve();
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  await committed.promise;
  for (let i = 1; i <= 3; i++) {
    committed = Promise.withResolvers<void>();
    window!.next();
    await vi.runOnlyPendingTimersAsync();
    await committed.promise;
    expect(reader).toHaveBeenCalledTimes(i + 1);
    expect(reader.mock.calls[i][2].cursor).toMatchObject({ after: String(i) });
    expect(reader.mock.calls[1][2].cursor).toMatchObject({ after: '1' });
  }
  mounted.unmount();
  client.clear();
});

it('clears the visible account synchronously and ignores a late previous-account result', async () => {
  const client = new QueryClient();
  const [viewer, setViewer] = createSignal<string | undefined>('first');
  const started = Promise.withResolvers<void>();
  const previous = Promise.withResolvers<ContactDirectoryPage>();
  const current = Promise.withResolvers<ContactDirectoryPage>();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (user) => {
      if (user === 'first') {
        started.resolve();
        return previous.promise;
      }
      return result(user, '');
    });
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  function Harness() {
    const directory = createContactDirectoryWindow(
      () => ({ userId: viewer() }),
      reader
    );
    window = directory;
    createEffect(() => {
      const data = directory.data();
      if (data?.users[0]?.id === 'second') current.resolve(data);
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await started.promise;
  setViewer('second');
  expect(window!.data()).toBeUndefined();
  await current.promise;
  previous.resolve(result('first', ''));
  await previous.promise;
  expect(window!.data()?.users[0]?.id).toBe('second');
  expect(reader.mock.calls[0][3].aborted).toBe(true);
  mounted.unmount();
  client.clear();
});

it('retains a same-scope window on ordinary errors but hides it on scope rejection', async () => {
  const client = new QueryClient();
  const loaded = Promise.withResolvers<void>();
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockResolvedValue(result('viewer', ''));
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  function Harness() {
    const directory = createContactDirectoryWindow(
      () => ({ userId: 'viewer' }),
      reader
    );
    window = directory;
    createEffect(() => {
      if (directory.data()) loaded.resolve();
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await loaded.promise;
  reader.mockRejectedValue(new Error('offline'));
  await window!.retry();
  expect(window!.data()?.users).toHaveLength(1);
  reader.mockRejectedValue(new ContactDirectoryScopeError());
  await window!.retry();
  expect(window!.data()).toBeUndefined();
  mounted.unmount();
  client.clear();
});
