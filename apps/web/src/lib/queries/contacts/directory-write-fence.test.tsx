import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheChangeListener } from '@graphql-cache/host/types';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ContactDirectoryPage, readContactDirectory } from './directory';
import { createContactDirectoryWindow } from './directory-query';

vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('fences a pending local reply when person data changes without changing the account or query', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const client = new QueryClient();
  const old = Promise.withResolvers<ContactDirectoryPage>();
  const fresh: ContactDirectoryPage = {
    source: 'cache',
    sync: 'partial',
    offline: false,
    query: '',
    users: [],
    nextCursor: null,
  };
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockResolvedValue(fresh)
    .mockImplementationOnce(() => old.promise);
  let changed: CacheChangeListener | undefined;
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    onCacheChanged: (callback: CacheChangeListener) => {
      changed = callback;
      return () => {};
    },
  };
  let window: ReturnType<typeof createContactDirectoryWindow> | undefined;
  function Harness() {
    window = createContactDirectoryWindow(
      () => ({ userId: 'viewer', host }),
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
  expect(reader).toHaveBeenCalledOnce();
  changed?.(parseCacheRevision('1'), { searchChangedBuckets: ['person'] });
  await vi.advanceTimersByTimeAsync(300);
  expect(reader).toHaveBeenCalledTimes(2);
  expect(reader.mock.calls[0][3].aborted).toBe(true);
  old.resolve({
    ...fresh,
    users: [
      {
        id: 'macro|obsolete@example.com',
        email: 'obsolete@example.com',
        name: 'Obsolete',
      },
    ],
  });
  await vi.runOnlyPendingTimersAsync();
  expect(window?.data()?.users).toEqual([]);
  expect(client.getQueryCache().getAll()).toHaveLength(1);
  client.clear();
});
