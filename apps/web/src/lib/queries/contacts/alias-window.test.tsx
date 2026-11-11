import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createEffect, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createContactAliasWindow } from './alias-window';
import type { resolveContactDirectory } from './lookup';

const resolve = vi.hoisted(() => vi.fn<typeof resolveContactDirectory>());
vi.mock('./use-directory', () => ({
  useContactDirectoryScope: () => () => ({ userId: 'viewer' }),
}));
vi.mock('./lookup', async (original) => ({
  ...(await original<typeof import('./lookup')>()),
  resolveContactDirectory: resolve,
}));
afterEach(() => vi.useRealTimers());

it('resolves only the active alias window and discards old private-user/query results', async () => {
  vi.useFakeTimers();
  resolve.mockImplementation(async (_viewer, _host, lookup) => ({
    users: lookup.values.map((email) => ({
      id: `macro|${email}`,
      email,
      name: email,
    })),
    unresolved: [],
    source: 'server',
    offline: false,
  }));
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    email: `person${index}@example.com`,
  }));
  const [query, setQuery] = createSignal('name');
  const client = new QueryClient();
  let source:
    | ReturnType<typeof createContactAliasWindow<(typeof rows)[number]>>
    | undefined;
  let committed = Promise.withResolvers<void>();
  function Harness() {
    source = createContactAliasWindow({
      rows: () => rows,
      email: (row) => row.email,
      search: query,
      enabled: () => true,
      hasMore: () => false,
      loadMore: async () => {},
    });
    createEffect(() => {
      if (source?.users().length) committed.resolve();
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.runOnlyPendingTimersAsync();
  await committed.promise;
  for (let page = 1; page < 10; page++) {
    committed = Promise.withResolvers<void>();
    await source?.loadMore();
    await vi.runOnlyPendingTimersAsync();
    await committed.promise;
    expect(source?.rows()).toHaveLength(50);
    expect(source?.users()).toHaveLength(50);
    expect(source?.rows()[0].id).toBe(String(page * 50));
    expect(client.getQueryCache().getAll()).toHaveLength(1);
  }
  expect(resolve.mock.calls.every((call) => call[2].values.length === 50)).toBe(
    true
  );
  setQuery('other');
  await vi.runOnlyPendingTimersAsync();
  expect(source?.rows()[0].id).toBe('0');
  mounted.unmount();
  await vi.runOnlyPendingTimersAsync();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  client.clear();
});
