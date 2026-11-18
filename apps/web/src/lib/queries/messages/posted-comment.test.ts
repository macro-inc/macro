import { afterEach, expect, it, vi } from 'vitest';
import { hasPostedComment } from './posted-comment';

const list = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: { list },
}));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
afterEach(() => list.mockReset());

it('preserves an anchor owned by a root on a later page', async () => {
  const cursor = { created_at: '2026-01-01T00:00:00Z', id: 'earlier' };
  list.mockResolvedValueOnce({ items: [], next_cursor: cursor });
  list.mockResolvedValueOnce({
    items: [{ state: { anchor: { type: 'markdown', mark_id: 'saved' } } }],
    next_cursor: null,
  });
  expect(await hasPostedComment('document', 'saved')).toBe(true);
  expect(list).toHaveBeenNthCalledWith(
    2,
    { type: 'document', id: 'document' },
    { anchored: true, limit: 100, cursor }
  );
});

it('does not infer an orphan when a page fails', async () => {
  list.mockRejectedValueOnce(new Error('unavailable'));
  await expect(hasPostedComment('document', 'saved')).rejects.toThrow(
    'unavailable'
  );
});

it('checks the server again after an earlier lookup found no posted comment', async () => {
  list.mockResolvedValueOnce({ items: [], next_cursor: null });
  expect(await hasPostedComment('document', 'new-mark')).toBe(false);
  list.mockResolvedValueOnce({
    items: [{ state: { anchor: { type: 'markdown', mark_id: 'new-mark' } } }],
    next_cursor: null,
  });
  expect(await hasPostedComment('document', 'new-mark')).toBe(true);
});
