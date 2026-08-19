import {
  clearOwnTouchFloors,
  ownTouchStamp,
} from '@queries/soup/normalized-cache/own-touch';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { soupItemMatchesListView } from './list-views';

const documentItem = (touched_at?: string): SoupApiItem =>
  ({
    tag: 'document',
    data: { id: 'd-1', title: 'doc' },
    frecency_score: 0,
    ...(touched_at ? { touched_at } : {}),
  }) as unknown as SoupApiItem;

afterEach(() => {
  clearOwnTouchFloors();
});

describe('soupItemMatchesListView', () => {
  it('recent admits only rows carrying a touch timestamp', () => {
    // Membership in the recent view is "did I touch it": a websocket insert
    // of someone else's entity (no touched_at) must not enter the feed.
    expect(soupItemMatchesListView(documentItem(), 'recent')).toBe(false);
    expect(
      soupItemMatchesListView(documentItem('2026-08-15T00:00:00Z'), 'recent')
    ).toBe(true);
  });

  it('recent admits rows with an outstanding optimistic own-touch', () => {
    // Own creations arrive via a single-entity fetch that carries no
    // touched_at; the recorded floor is what admits them.
    ownTouchStamp('d-1');
    expect(soupItemMatchesListView(documentItem(), 'recent')).toBe(true);
  });

  it('inbox admits rows regardless of touch', () => {
    expect(soupItemMatchesListView(documentItem(), 'inbox')).toBe(true);
  });

  it('flow admits only touched rows or undone notifications', () => {
    // Flow is inbox ∪ recent: an entity belonging to neither half (no touch,
    // no undone notification) must not enter the merged feed.
    expect(soupItemMatchesListView(documentItem(), 'flow')).toBe(false);
    expect(
      soupItemMatchesListView(documentItem('2026-08-19T00:00:00Z'), 'flow')
    ).toBe(true);

    const withUndone = {
      tag: 'document',
      data: { id: 'd-1', title: 'doc', notifications: [{ done: false }] },
      frecency_score: 0,
    } as unknown as SoupApiItem;
    expect(soupItemMatchesListView(withUndone, 'flow')).toBe(true);

    const withDoneOnly = {
      tag: 'document',
      data: { id: 'd-1', title: 'doc', notifications: [{ done: true }] },
      frecency_score: 0,
    } as unknown as SoupApiItem;
    expect(soupItemMatchesListView(withDoneOnly, 'flow')).toBe(false);

    // The viewer's own outstanding touch admits the row too.
    ownTouchStamp('d-1');
    expect(soupItemMatchesListView(documentItem(), 'flow')).toBe(true);
  });
});
