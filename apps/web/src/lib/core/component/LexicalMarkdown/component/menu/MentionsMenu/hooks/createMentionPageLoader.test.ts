import { createEffect, createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { MentionBucketId } from '../MentionsMenuController';
import { createMentionPageLoader } from './createMentionPageLoader';

it('does not turn a bounded empty/duplicate scan into an automatic loading loop', async () => {
  const [loading, setLoading] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [itemCount, setItemCount] = createSignal(1);
  const [query, setQuery] = createSignal('');
  const loadMore = vi.fn(async () => {
    setLoading(true);
    await Promise.resolve();
    setLoading(false);
  });
  const bucket = {
    id: 'documents' as const,
    hasMore: () => true,
    isLoadingMore: loading,
    loadMore,
  };
  const dispose = createRoot((dispose) => {
    const maybeLoad = createMentionPageLoader();
    createEffect(() =>
      maybeLoad({
        bucket,
        selectedIndex: selectedIndex(),
        itemCount: itemCount(),
        query: query(),
      })
    );
    return dispose;
  });
  try {
    await vi.waitFor(() => expect(loading()).toBe(false));
    expect(loadMore).toHaveBeenCalledOnce();
    setSelectedIndex(1);
    await vi.waitFor(() => expect(loading()).toBe(false));
    expect(loadMore).toHaveBeenCalledTimes(2);
    setItemCount(2);
    await vi.waitFor(() => expect(loading()).toBe(false));
    expect(loadMore).toHaveBeenCalledTimes(3);
    setQuery('new query');
    await vi.waitFor(() => expect(loading()).toBe(false));
    expect(loadMore).toHaveBeenCalledTimes(4);
  } finally {
    dispose();
  }
});

it('allows another automatic load after leaving or changing category', () => {
  const loadMore = vi.fn();
  const maybeLoad = createMentionPageLoader();
  const args = (id: MentionBucketId) => ({
    bucket: { id, hasMore: () => true, loadMore },
    query: '',
    selectedIndex: 0,
    itemCount: 2,
  });
  maybeLoad(args('documents'));
  maybeLoad(args('documents'));
  expect(loadMore).toHaveBeenCalledOnce();
  maybeLoad(args('channels'));
  expect(loadMore).toHaveBeenCalledTimes(2);
  maybeLoad({ ...args('channels'), bucket: undefined });
  maybeLoad(args('channels'));
  expect(loadMore).toHaveBeenCalledTimes(3);
});
