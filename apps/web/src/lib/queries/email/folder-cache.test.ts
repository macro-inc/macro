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

import { soupKeys } from '../soup/keys';
import { handleRefreshEmail } from './sync';

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  client.clear();
  vi.useRealTimers();
});

it('refreshes isolated folder discovery and retained rows on provider changes without refetching All Mail', async () => {
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
  // Bursts coalesce, but the last change still refreshes both folders.
  expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
    false,
    false,
    false,
  ]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    false,
  ]);
});
