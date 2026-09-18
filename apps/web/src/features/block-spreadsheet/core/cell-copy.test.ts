import { describe, expect, it } from 'vitest';
import {
  copyRange,
  fillCopies,
  rangeCopies,
  readCopiedRange,
} from './cell-copy';
import { SPREADSHEET_DEFAULT_STYLE } from './spreadsheet-document';

describe('spreadsheet clipboard and fill regions', () => {
  it('snapshots a reverse selection including blank cells and formatting', () => {
    const range = copyRange(
      { A1: { value: '=B1', bold: true } },
      { anchor: { row: 1, column: 1 }, focus: { row: 0, column: 0 } }
    );
    expect(range.cells).toEqual([
      [{ value: '=B1', bold: true }, { value: '' }],
      [{ value: '' }, { value: '' }],
    ]);
    expect(readCopiedRange(JSON.stringify(range))).toEqual(range);
    expect(rangeCopies(range, { row: 3, column: 2 })[0]).toEqual({
      from: { row: 0, column: 0 },
      to: { row: 3, column: 2 },
      cell: { value: '=B1', bold: true },
    });
  });

  it('repeats a source block in either direction without overwriting its source', () => {
    const source = {
      anchor: { row: 2, column: 1 },
      focus: { row: 3, column: 1 },
    };
    const target = {
      anchor: { row: 0, column: 1 },
      focus: { row: 5, column: 1 },
    };
    expect(
      fillCopies(
        { B3: { value: '=A3' }, B4: { value: '=A4' } },
        source,
        target
      ).map(({ from, to }) => [from.row, to.row])
    ).toEqual([
      [2, 0],
      [3, 1],
      [2, 4],
      [3, 5],
    ]);
  });

  it('round trips rich formatting and rejects unsafe clipboard styles', () => {
    const range = copyRange(
      {
        A1: {
          ...SPREADSHEET_DEFAULT_STYLE,
          value: 'rich',
          italic: true,
          fontSize: 30,
          fillColor: '#123456',
          horizontalAlign: 'center',
          borderRight: true,
        },
      },
      { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }
    );
    expect(readCopiedRange(JSON.stringify(range))).toEqual(range);
    for (const style of [
      { fillColor: 'url(evil)' },
      { fontSize: 99 },
      { decimals: -2 },
      { borderRight: 'yes' },
    ]) {
      expect(
        readCopiedRange(
          JSON.stringify({ ...range, cells: [[{ value: '', ...style }]] })
        )
      ).toBeUndefined();
    }
  });

  it('round trips cut metadata while rejecting unknown clipboard operation flags', () => {
    const range = {
      version: 1,
      cut: true,
      top: 0,
      left: 0,
      cells: [[{ value: '=B1', italic: true }]],
    };
    expect(readCopiedRange(JSON.stringify(range))).toEqual(range);
    expect(
      readCopiedRange(JSON.stringify({ ...range, cut: 'true' }))
    ).toBeUndefined();
  });

  it('rejects malformed or oversized internal clipboard data', () => {
    for (const data of [
      null,
      { version: 1, top: -1, left: 0, cells: [[{ value: 'x' }]] },
      { version: 1, top: 0, left: 26, cells: [[{ value: 'x' }]] },
      { version: 1, top: 0, left: 0, cells: [[{ value: 'x' }], []] },
      { version: 1, top: 0, left: 0, cells: [[{ value: 'x'.repeat(10001) }]] },
    ]) {
      expect(readCopiedRange(JSON.stringify(data))).toBeUndefined();
    }
  });
});
