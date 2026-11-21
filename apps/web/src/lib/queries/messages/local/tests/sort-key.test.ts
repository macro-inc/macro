import { describe, expect, it } from 'vitest';
import {
  cursorFromSortKey,
  liveReplySortKey,
  rootSortKey,
  sortKeyFromCursor,
} from '../sort-key';

const ID = '0198c0de-0000-7000-8000-00000000000a';

describe('channel sort keys', () => {
  it('keeps the stored microseconds a Date would drop', () => {
    expect(rootSortKey('2026-11-01T10:00:00.123456Z', ID)).toBe(
      `00001793527200123456-${ID}`
    );
  });

  it('reads offsets and short or absent fractions', () => {
    const utc = rootSortKey('2026-11-01T10:00:00Z', ID);
    expect(rootSortKey('2026-11-01T12:00:00+02:00', ID)).toBe(utc);
    expect(rootSortKey('2026-11-01T10:00:00.5Z', ID)).toBe(
      `00001793527200500000-${ID}`
    );
  });

  it('orders bytewise like (created_at, id)', () => {
    const keys = [
      rootSortKey('2026-11-01T10:00:00.000002Z', ID),
      rootSortKey('2026-11-01T10:00:00.000001Z', ID),
      rootSortKey('2026-11-01T09:59:59.999999Z', ID),
    ];
    expect([...keys].sort()).toEqual([...keys].reverse());
  });

  it('round-trips a cursor through its sort key', () => {
    const cursor = { created_at: '2026-11-01T10:00:00.123456Z', id: ID };
    const key = sortKeyFromCursor(cursor);
    expect(key && cursorFromSortKey(key)).toEqual(cursor);
  });

  it('rejects what is not a root position', () => {
    expect(rootSortKey('not a time', ID)).toBeUndefined();
    expect(cursorFromSortKey(`~-00001793527200123456-${ID}`)).toBeUndefined();
  });

  it('sorts a live reply after imported ones', () => {
    const live = liveReplySortKey('2026-11-01T10:00:00Z', ID);
    expect(live && live > `00000000000000000009-${live.slice(2)}`).toBe(true);
  });
});
