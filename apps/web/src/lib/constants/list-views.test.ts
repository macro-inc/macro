import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import { soupItemMatchesListView } from './list-views';

const documentItem = (touched_at?: string): SoupApiItem =>
  ({
    tag: 'document',
    data: { id: 'd-1', title: 'doc' },
    frecency_score: 0,
    ...(touched_at ? { touched_at } : {}),
  }) as unknown as SoupApiItem;

describe('soupItemMatchesListView', () => {
  it('recent admits only rows carrying a touch timestamp', () => {
    // Membership in the recent view is "did I touch it": a websocket insert
    // of someone else's entity (no touched_at) must not enter the feed.
    expect(soupItemMatchesListView(documentItem(), 'recent')).toBe(false);
    expect(
      soupItemMatchesListView(documentItem('2026-08-15T00:00:00Z'), 'recent')
    ).toBe(true);
  });

  it('inbox admits rows regardless of touch', () => {
    expect(soupItemMatchesListView(documentItem(), 'inbox')).toBe(true);
  });
});
