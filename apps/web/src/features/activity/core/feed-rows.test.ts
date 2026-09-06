import { describe, expect, it } from 'vitest';
import { decodeActivityEvent } from '../queries/decode';
import { createdEvent, editedEvent } from '../queries/fixtures';
import { flattenFeed, reuseRows, shouldFetchMore } from './feed-rows';

const created = decodeActivityEvent(createdEvent);
const edited = decodeActivityEvent(editedEvent);

describe('flattenFeed', () => {
  it('interleaves day headers and events in order and ends with a tail when more pages exist', () => {
    const rows = flattenFeed(
      [
        { key: 'today', label: 'Today', events: [created] },
        { key: 'yesterday', label: 'Yesterday', events: [edited] },
      ],
      { hasMore: true }
    );
    expect(rows.map((row) => row.kind)).toEqual([
      'day',
      'event',
      'day',
      'event',
      'tail',
    ]);
    expect(rows[0]).toEqual({ kind: 'day', key: 'today', label: 'Today' });
    expect(rows[1]).toEqual({ kind: 'event', event: created });
  });

  it('omits the tail on the last page', () => {
    const rows = flattenFeed(
      [{ key: 'today', label: 'Today', events: [created] }],
      { hasMore: false }
    );
    expect(rows.map((row) => row.kind)).toEqual(['day', 'event']);
  });
});

describe('reuseRows', () => {
  it('keeps previous row objects for matching keys and adds the rest', () => {
    const previous = flattenFeed(
      [{ key: 'today', label: 'Today', events: [created] }],
      { hasMore: true }
    );
    const next = flattenFeed(
      [
        { key: 'today', label: 'Today', events: [{ ...created }] },
        { key: 'yesterday', label: 'Yesterday', events: [edited] },
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
      'event',
      'day',
      'event',
    ]);
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
