import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let client: QueryClient;
vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('./backfill', () => ({
  clearBackfillProgress: vi.fn(),
  invalidateBackfillJobs: vi.fn(),
  setBackfillProgress: vi.fn(),
}));
vi.mock('./link', () => ({ invalidateEmailLinks: vi.fn() }));
vi.mock('../soup/normalized-cache', () => ({ invalidateAllSoup: vi.fn() }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
const revalidateMailFolderLists = vi.hoisted(() =>
  vi.fn(async () => undefined)
);
vi.mock('@queries/soup/graphql/mail-list-revalidation', () => ({
  revalidateMailFolderLists,
}));

import { handleRefreshEmail } from './sync';

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient();
  revalidateMailFolderLists.mockClear();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  client.clear();
  vi.useRealTimers();
});

it('reads the folder lists again on provider changes, coalescing bursts', async () => {
  handleRefreshEmail({ event: 'update_labels', link_id: 'inbox' });
  expect(revalidateMailFolderLists).toHaveBeenCalledTimes(1);

  handleRefreshEmail({ event: 'upsert_message', link_id: 'inbox' });
  handleRefreshEmail({ event: 'delete_message', link_id: 'inbox' });
  // Bursts coalesce, but the last change still refreshes the folders.
  expect(revalidateMailFolderLists).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(revalidateMailFolderLists).toHaveBeenCalledTimes(2);
});

it('reads the folder lists again when an inbox is removed or backfills', async () => {
  handleRefreshEmail({ event: 'link_removed', link_id: 'inbox' });
  expect(revalidateMailFolderLists).toHaveBeenCalledTimes(1);

  handleRefreshEmail({
    event: 'backfill_progress',
    link_id: 'inbox',
    status: 'progress',
    completed_threads: 1,
    total_threads: 2,
  });
  expect(revalidateMailFolderLists).toHaveBeenCalledTimes(2);
});
