import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { FeedPreferences, FeedSource } from '../context/feed-source';
import { TEST_ITEMS } from '../tests/fixtures';
import { createFeed } from './feed';

function setup() {
  const [items, setItems] = createSignal(TEST_ITEMS);
  const [hiddenIds, setHiddenIds] = createSignal<string[]>([]);
  const preferences: FeedPreferences = {
    prompt: () => '',
    setPrompt: () => {},
    hiddenIds,
    setHiddenIds,
  };
  const source: FeedSource = {
    items,
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    canRetry: () => true,
    refresh: async () => {},
  };
  const start = vi.fn(async () => {});
  return {
    feed: createFeed(source, preferences, { start, openSource: () => {} }),
    setItems,
    hiddenIds,
    start,
  };
}

describe('live feed state', () => {
  it('keeps dismissal across new projection results and undo restores it', () =>
    createRoot((dispose) => {
      const { feed, setItems, hiddenIds } = setup();
      feed.dismiss('account-agent');
      setItems([...TEST_ITEMS]);
      expect(feed.visible().some((item) => item.id === 'account-agent')).toBe(
        false
      );
      expect(hiddenIds()).toEqual(['account-agent']);
      feed.undo();
      expect(feed.visible().some((item) => item.id === 'account-agent')).toBe(
        true
      );
      feed.setFilter('revisit');
      expect(feed.visible().map((item) => item.id)).toEqual([
        'unfinished-review',
      ]);
      dispose();
    }));
  it('filters financial ideas without duplicating shared ideas in All', () =>
    createRoot((dispose) => {
      const { feed } = setup();
      feed.setFilter('save_money');
      expect(feed.visible().map((item) => item.id)).toEqual([
        'pipeline-database',
        'weekly-routine',
      ]);
      feed.setFilter('make_money');
      expect(feed.visible().map((item) => item.id)).toEqual([
        'account-agent',
        'pipeline-database',
      ]);
      feed.dismiss('pipeline-database');
      expect(feed.visible().map((item) => item.id)).toEqual(['account-agent']);
      feed.setFilter('save_money');
      expect(feed.visible().map((item) => item.id)).toEqual(['weekly-routine']);
      feed.setFilter('idea');
      expect(feed.visible()).toHaveLength(2);
      feed.setFilter('all');
      expect(feed.visible()).toHaveLength(4);
      dispose();
    }));
  it('keeps a suggestion available when opening its action fails', async () => {
    const { feed, start, dispose } = createRoot((dispose) => ({
      ...setup(),
      dispose,
    }));
    start.mockRejectedValueOnce(new Error('unavailable'));
    await feed.start(TEST_ITEMS[0]!);
    expect(feed.actionError()).toBe(true);
    expect(feed.openingId()).toBeUndefined();
    expect(feed.visible()).toHaveLength(TEST_ITEMS.length);
    dispose();
  });
});
