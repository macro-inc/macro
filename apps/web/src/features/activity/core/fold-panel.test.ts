import { describe, expect, it } from 'vitest';
import type { FeedEntry } from './collapse-runs';
import type { ActivityEvent } from './event';
import { foldPanel } from './fold-panel';

function single(id: string): FeedEntry {
  const event: ActivityEvent = {
    id,
    actorId: 'macro|sarah@example.com',
    entityId: 'doc-1',
    entityType: 'document',
    occurredAt: '2026-08-21T12:00:00.000Z',
    action: { kind: 'edited' },
  };
  return { kind: 'single', event };
}

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => single(`evt-${index}`));

describe('foldPanel', () => {
  it('shows everything when the entries fit within the limit', () => {
    const list = entries(3);
    expect(foldPanel(list, 3)).toEqual({
      head: list,
      hidden: 0,
      tail: undefined,
    });
  });

  it('does not fold one extra entry, since the tail would show it anyway', () => {
    const list = entries(4);
    expect(foldPanel(list, 3)).toEqual({
      head: list,
      hidden: 0,
      tail: undefined,
    });
  });

  it('keeps the newest entries, counts the fold, and pins the oldest last', () => {
    const list = entries(20);
    const fold = foldPanel(list, 3);

    expect(fold.head).toEqual(list.slice(0, 3));
    expect(fold.hidden).toBe(16);
    expect(fold.tail).toBe(list[19]);
  });

  it('folds exactly one entry when the list is two past the limit', () => {
    const list = entries(5);
    const fold = foldPanel(list, 3);
    expect(fold.head.length + fold.hidden + 1).toBe(list.length);
    expect(fold.hidden).toBe(1);
  });

  it('returns nothing for no entries', () => {
    expect(foldPanel([], 3)).toEqual({ head: [], hidden: 0, tail: undefined });
  });
});
