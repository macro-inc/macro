import { describe, expect, it } from 'vitest';
import { EXPANDED, nextPillCompaction } from './pill-compaction';

describe('nextPillCompaction', () => {
  it('stays expanded while the pills fit', () => {
    expect(nextPillCompaction(EXPANDED, { overflow: 0, rowWidth: 800 })).toBe(
      EXPANDED
    );
  });

  it('compacts when the expanded pills overflow, remembering by how much', () => {
    expect(
      nextPillCompaction(EXPANDED, { overflow: 60, rowWidth: 700 })
    ).toEqual({ compact: true, rowWidth: 700, deficit: 60 });
  });

  it('expands only once the row has grown by the deficit', () => {
    const compact = nextPillCompaction(EXPANDED, {
      overflow: 60,
      rowWidth: 700,
    });
    expect(nextPillCompaction(compact, { overflow: 0, rowWidth: 740 })).toBe(
      compact
    );
    expect(nextPillCompaction(compact, { overflow: 0, rowWidth: 760 })).toBe(
      EXPANDED
    );
  });
});
