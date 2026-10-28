import type { SoupApiItem } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import { groupCachedMailByDate } from './mail-date-groups';

function email(
  id: string,
  sortTs: string
): Extract<SoupApiItem, { tag: 'emailThread' }> {
  // Date grouping reads only identity and the Mail view's selected sort time.
  return { tag: 'emailThread', data: { id, sortTs } } as Extract<
    SoupApiItem,
    { tag: 'emailThread' }
  >;
}

describe('cached Mail date groups', () => {
  it('uses UTC boundaries and keeps cached sort order and counts within each bin', () => {
    const now = new Date('2026-09-22T00:10:00Z');
    const items = [
      email('today-late', '2026-09-21T20:05:00-04:00'),
      email('today-early', '2026-09-22T00:01:00Z'),
      email('yesterday', '2026-09-21T23:59:00Z'),
      email('week', '2026-09-16T12:00:00Z'),
      email('last-week', '2026-09-15T12:00:00Z'),
      email('month', '2026-09-08T12:00:00Z'),
      email('last-month', '2026-08-22T12:00:00Z'),
      email('older', '2026-07-22T12:00:00Z'),
      email('future', '2026-09-25T12:00:00Z'),
    ];
    const data = {
      entities: [],
      cachedMail: true,
      groups: undefined,
      itemsById: Object.fromEntries(items.map((item) => [item.data.id, item])),
    };
    const grouped = groupCachedMailByDate(data, now);
    expect(
      grouped.groups?.map((group) => [
        group.key,
        group.itemIds,
        group.totalCount,
        group.nextCursor,
      ])
    ).toEqual([
      ['today', ['today-late', 'today-early'], 2, null],
      ['yesterday', ['yesterday'], 1, null],
      ['this_week', ['week'], 1, null],
      ['last_week', ['last-week'], 1, null],
      ['this_month', ['month'], 1, null],
      ['last_month', ['last-month'], 1, null],
      ['older', ['older', 'future'], 2, null],
    ]);
    expect(grouped.itemsById).toBe(data.itemsById);
    expect(
      groupCachedMailByDate(data, new Date('2026-09-23T00:00:00Z')).groups?.[0]
    ).toMatchObject({
      key: 'yesterday',
      itemIds: ['today-late', 'today-early'],
    });
  });
});
