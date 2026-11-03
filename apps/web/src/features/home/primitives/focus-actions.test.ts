import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../for-you/core/feed';
import { createFeedItems } from '../../for-you/primitives/feed';
import { TEST_ITEMS } from '../../for-you/tests/fixtures';
import { createFocusActions } from './focus-actions';

describe('live Home recommendations', () => {
  it('selects arriving suggestions and shares dismissals with the full feed', () =>
    createRoot((dispose) => {
      const [items, setItems] = createSignal<FeedItem[]>();
      const [hiddenIds, setHiddenIds] = createSignal<string[]>([]);
      const source = {
        items,
        loading: () => !items(),
        error: () => undefined,
        refreshing: () => false,
        canRetry: () => true,
        refresh: async () => {},
      };
      const preferences = {
        prompt: () => '',
        setPrompt: () => {},
        hiddenIds,
        setHiddenIds,
      };
      const home = createFocusActions(source, preferences);
      const full = createFeedItems(source, preferences);
      expect(home.selectedId()).toBeUndefined();
      setItems(TEST_ITEMS);
      expect(home.selectedId()).toBe('reply-needed');
      expect(home.move(1)).toBe('account-agent');
      home.dismiss('account-agent');
      expect(home.selectedId()).toBe('unfinished-review');
      expect(full.visible().some((item) => item.id === 'account-agent')).toBe(
        false
      );
      home.undo();
      expect(home.selectedId()).toBe('account-agent');
      expect(full.visible()).toHaveLength(5);
      for (const item of [...home.actions()]) home.dismiss(item.id);
      expect(home.move(1)).toBeUndefined();
      home.undo();
      expect(home.actions()).toHaveLength(1);
      dispose();
    }));
});
