import type { GithubPullRequestEntity } from '@entity';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createReviewsListController } from './create-reviews-list-controller';

const review = (id: string) => ({ id }) as GithubPullRequestEntity;

describe('Reviews list controller', () => {
  it('keeps focus and selection across a temporarily disabled detail query', () => {
    createRoot((dispose) => {
      const rows = [review('a'), review('b'), review('c')];
      const [items, setItems] = createSignal(rows);
      const list = createReviewsListController(items, vi.fn());

      list.focus.set('b');
      list.selection.set('a', true);
      list.selection.set('c', true, { range: true });
      expect(list.selection.items().map((item) => item.id)).toEqual([
        'a',
        'b',
        'c',
      ]);

      setItems([]);
      expect(list.focus.requestedKey()).toBe('b');
      expect(list.selection.items()).toEqual([]);

      setItems(rows);
      expect(list.focus.key()).toBe('b');
      expect(list.selection.items().map((item) => item.id)).toEqual([
        'a',
        'b',
        'c',
      ]);
      dispose();
    });
  });

  it('routes keyboard activation with the requested split intent', () => {
    createRoot((dispose) => {
      const onOpen = vi.fn();
      const list = createReviewsListController(() => [review('pr')], onOpen);
      list.activate.key('pr', {
        reason: 'keyboard',
        metadata: { newSplit: true },
      });
      expect(onOpen).toHaveBeenCalledWith('pr', true);
      dispose();
    });
  });
});
