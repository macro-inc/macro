import { describe, expect, it } from 'vitest';
import type { CodeLocation, CodeRow } from './model';
import { readerItems } from './reader-items';

const rows: CodeRow[] = Array.from({ length: 100_000 }, (_, i) => ({
  old: i,
  new: i,
  changed: i === 500,
  key: String(i),
}));
const at = (line: number, endLine?: number): CodeLocation => ({
  path: 'large.ts',
  side: 'new',
  line,
  endLine,
});

describe('large-file context', () => {
  it('folds untouched source while retaining the complete selected range and discussions', () => {
    const items = readerItems(rows, [at(90000)], at(4000, 4030), false, []);
    const lines = items.flatMap((item) =>
      item.kind === 'code' ? [item.row.new! + 1] : []
    );
    expect(items.length).toBeLessThan(80);
    for (let line = 4000; line <= 4030; line++) expect(lines).toContain(line);
    expect(lines).toContain(90000);
    expect(items.filter((item) => item.kind === 'discussion')).toHaveLength(1);
    expect(lines).toContain(501);
  });
  it('can expand all source without losing the final line', () => {
    const items = readerItems(rows, [], undefined, true, []);
    expect(items).toHaveLength(100000);
    expect(items.at(-1)).toEqual({ kind: 'code', row: rows[99999] });
  });
  it('places a range discussion below the selected region', () => {
    const location = at(4000, 4005);
    const items = readerItems(rows, [location], location, false, []);
    const index = items.findIndex((item) => item.kind === 'discussion');
    expect(items[index]).toEqual({ kind: 'discussion', location });
    expect(items[index - 1]).toEqual({ kind: 'code', row: rows[4004] });
  });
  it('expands just the requested edge of an unchanged gap', () => {
    const initial = readerItems(rows, [], at(90000), false, []);
    const fold = initial.find(
      (item) => item.kind === 'fold' && item.count > 80000
    );
    expect(fold?.kind).toBe('fold');
    if (fold?.kind !== 'fold') return;
    const above = readerItems(rows, [], at(90000), false, [
      [fold.end - 9, fold.end],
    ]);
    const below = readerItems(rows, [], at(90000), false, [
      [fold.start, fold.start + 9],
    ]);
    expect(
      above.some(
        (item) => item.kind === 'code' && item.row.key === rows[fold.end].key
      )
    ).toBe(true);
    expect(
      above.some(
        (item) => item.kind === 'code' && item.row.key === rows[fold.start].key
      )
    ).toBe(false);
    expect(
      below.some(
        (item) => item.kind === 'code' && item.row.key === rows[fold.start].key
      )
    ).toBe(true);
    expect(
      below.some(
        (item) => item.kind === 'code' && item.row.key === rows[fold.end].key
      )
    ).toBe(false);
  });
});
