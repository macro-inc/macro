import { QueryClient, QueryObserver } from '@tanstack/solid-query';
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

import { soupKeys } from '../soup/keys';
import { invalidateAllSoup } from '../soup/normalized-cache';
import { setBackfillProgress } from './backfill';
import { invalidateEmailFolderQueries } from './folder-cache';
import { handleRefreshEmail } from './sync';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  client = new QueryClient();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  client.clear();
  vi.useRealTimers();
});

it('leaves provider-hint IO to the mounted reader pagination gate', async () => {
  const keys = ['spam', 'trash', 'all'].map(
    (emailView) =>
      soupKeys.astItems({ params: {}, body: { emailView }, transport: 'rest' })
        .queryKey
  );
  const reset = () =>
    keys.forEach((key) => client.setQueryData(key, { pages: [] }));
  reset();
  handleRefreshEmail({ event: 'update_labels', link_id: 'inbox' });
  expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    false,
  ]);
  reset();
  handleRefreshEmail({ event: 'upsert_message', link_id: 'inbox' });
  handleRefreshEmail({ event: 'delete_message', link_id: 'inbox' });
  // Mounted readers coalesce the hints after paging; the global handler
  // must not bypass that gate for any of these lists.
  expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    false,
  ]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    false,
  ]);
});

it('records backfill progress without globally restarting mounted page chains', async () => {
  handleRefreshEmail({
    event: 'backfill_progress',
    link_id: 'inbox',
    status: 'progress',
    completed_threads: 50,
    total_threads: 104,
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(setBackfillProgress).toHaveBeenCalledWith('inbox', 50, 104);
  expect(invalidateAllSoup).toHaveBeenCalledWith('none');
});

it('keeps explicit folder invalidation scoped away from ordinary lists', async () => {
  const keys = ['spam', 'trash', 'all'].map(
    (emailView) =>
      soupKeys.astItems({ params: {}, body: { emailView }, transport: 'rest' })
        .queryKey
  );
  for (const key of keys) client.setQueryData(key, { pages: [] });
  await invalidateEmailFolderQueries();
  expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    false,
  ]);
});

it('marks an unopened folder stale without refetching a mounted folder page chain', async () => {
  const key = soupKeys.astItems({
    params: {},
    body: { emailView: 'spam' },
    transport: 'rest',
  }).queryKey;
  client.setQueryData(key, { pages: [] });
  const read = vi.fn(async () => ({ pages: [] }));
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: read,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    handleRefreshEmail({ event: 'update_labels', link_id: 'inbox' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(read).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    observer.destroy();
  }
});
