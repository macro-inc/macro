import { describe, expect, it } from 'vitest';
import { decodeActivityEvent } from '../queries/decode';
import { createdEvent, editedEvent } from '../queries/fixtures';
import type { FeedEntry } from './collapse-runs';
import {
  type FeedRow,
  flattenFeed,
  pinnedDayLabel,
  reuseRows,
  shouldFetchMore,
} from './feed-rows';

const created: FeedEntry = {
  kind: 'single',
  event: decodeActivityEvent(createdEvent),
};
const edited: FeedEntry = {
  kind: 'single',
  event: decodeActivityEvent(editedEvent),
};
const withId = (entry: FeedEntry, id: string): FeedEntry =>
  entry.kind === 'single'
    ? { kind: 'single', event: { ...entry.event, id } }
    : entry;

const rails = (rows: ReturnType<typeof flattenFeed>) =>
  rows.flatMap((row) => (row.kind === 'entry' ? [row.rail] : []));

describe('flattenFeed', () => {
  it('interleaves day headers and events in order and ends with a tail when more pages exist', () => {
    const rows = flattenFeed(
      [
        { key: 'today', label: 'Today', entries: [created] },
        { key: 'yesterday', label: 'Yesterday', entries: [edited] },
      ],
      { hasMore: true }
    );
    expect(rows.map((row) => row.kind)).toEqual([
      'day',
      'entry',
      'day',
      'entry',
      'tail',
    ]);
    expect(rows[0]).toEqual({ kind: 'day', key: 'today', label: 'Today' });
    expect(rows[1]).toEqual({
      kind: 'entry',
      entry: created,
      rail: { above: false, below: false },
    });
  });

  it('omits the tail on the last page', () => {
    const rows = flattenFeed(
      [{ key: 'today', label: 'Today', entries: [created] }],
      { hasMore: false }
    );
    expect(rows.map((row) => row.kind)).toEqual(['day', 'entry']);
  });

  it('draws no rail around a single-entry day', () => {
    const rows = flattenFeed(
      [{ key: 'today', label: 'Today', entries: [created] }],
      { hasMore: false }
    );
    expect(rails(rows)).toEqual([{ above: false, below: false }]);
  });

  it('joins the entries of a day and stops the rail at the day header', () => {
    const rows = flattenFeed(
      [
        {
          key: 'today',
          label: 'Today',
          entries: [
            withId(created, 'e3'),
            withId(edited, 'e2'),
            withId(created, 'e1'),
          ],
        },
        { key: 'yesterday', label: 'Yesterday', entries: [edited] },
      ],
      { hasMore: false }
    );
    expect(rails(rows)).toEqual([
      { above: false, below: true },
      { above: true, below: true },
      { above: true, below: false },
      { above: false, below: false },
    ]);
  });
});

describe('reuseRows', () => {
  it('keeps previous row objects for matching keys and adds the rest', () => {
    const previous = flattenFeed(
      [{ key: 'today', label: 'Today', entries: [created] }],
      { hasMore: true }
    );
    const next = flattenFeed(
      [
        { key: 'today', label: 'Today', entries: [{ ...created }] },
        { key: 'yesterday', label: 'Yesterday', entries: [edited] },
      ],
      { hasMore: false }
    );
    const reused = reuseRows(previous, next);
    expect(reused[0]).toBe(previous[0]);
    expect(reused[1]).toBe(previous[1]);
    expect(reused[2]).toBe(next[2]);
    expect(reused[3]).toBe(next[3]);
    expect(reused.map((row) => row.kind)).toEqual([
      'day',
      'entry',
      'day',
      'entry',
    ]);
  });

  it('replaces the last entry of a day when the next page extends its rail below', () => {
    const previous = flattenFeed(
      [
        {
          key: 'today',
          label: 'Today',
          entries: [withId(created, 'e2'), withId(edited, 'e1')],
        },
      ],
      { hasMore: true }
    );
    const next = flattenFeed(
      [
        {
          key: 'today',
          label: 'Today',
          entries: [
            withId(created, 'e2'),
            withId(edited, 'e1'),
            withId(created, 'e0'),
          ],
        },
      ],
      { hasMore: false }
    );
    const reused = reuseRows(previous, next);
    expect(reused[1]).toBe(previous[1]);
    expect(reused[2]).toBe(next[2]);
    expect(reused[2]).toEqual(
      expect.objectContaining({ rail: { above: true, below: true } })
    );
    expect(reused[3]).toBe(next[3]);
  });
});

describe('pinnedDayLabel', () => {
  const rows: FeedRow[] = [
    { kind: 'overview' },
    ...flattenFeed(
      [
        { key: 'today', label: 'Today', entries: [created, edited] },
        { key: 'yesterday', label: 'Yesterday', entries: [created] },
      ],
      { hasMore: true }
    ),
  ];

  it.each([
    // [startIndex, expected]
    [0, undefined],
    [1, 'Today'],
    [3, 'Today'],
    [4, 'Yesterday'],
    [99, 'Yesterday'],
  ])('start index %i -> %s', (startIndex, expected) => {
    expect(pinnedDayLabel(rows, startIndex)).toBe(expected);
  });

  it('pins nothing while the feed has no day rows', () => {
    expect(
      pinnedDayLabel(
        [{ kind: 'overview' }, { kind: 'status', status: 'loading' }],
        1
      )
    ).toBeUndefined();
    expect(pinnedDayLabel([], 0)).toBeUndefined();
  });
});

describe('shouldFetchMore', () => {
  it.each([
    // [scrollSize, viewportSize, offset, expected]
    [3000, 800, 0, false],
    [3000, 800, 1399, false],
    [3000, 800, 1400, true],
    [3000, 800, 2200, true],
    [500, 800, 0, true],
    [1000, 50, 800, false],
    [1000, 50, 850, true],
  ])(
    'scrollSize %i viewport %i offset %i -> %s',
    (scrollSize, viewportSize, offset, expected) => {
      expect(shouldFetchMore({ scrollSize, viewportSize, offset })).toBe(
        expected
      );
    }
  );
});
