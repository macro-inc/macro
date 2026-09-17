import { describe, expect, it } from 'vitest';
import type { CellSelection } from './grid-selection';
import {
  borderEdits,
  csvImportEdits,
  findCells,
  replaceCellText,
  sortedRangeCopies,
  trimWhitespaceEdits,
} from './sheet-operations';

const origin: CellSelection = {
  anchor: { row: 0, column: 0 },
  focus: { row: 0, column: 0 },
};
const options = { matchCase: false, entireCell: false, formulas: false };

describe('spreadsheet range operations', () => {
  it('puts outer borders only on the perimeter of a reverse selection and clears interior edges', () => {
    const selection = {
      anchor: { row: 2, column: 2 },
      focus: { row: 0, column: 0 },
    };
    const edges = borderEdits(selection, 'outer');
    expect(edges.A1).toEqual({
      borderTop: true,
      borderBottom: false,
      borderLeft: true,
      borderRight: false,
    });
    expect(edges.C3).toEqual({
      borderTop: false,
      borderBottom: true,
      borderLeft: false,
      borderRight: true,
    });
    expect(edges.B2).toEqual({
      borderTop: false,
      borderBottom: false,
      borderLeft: false,
      borderRight: false,
    });
    expect(borderEdits(origin, 'all').A1).toEqual({
      borderTop: true,
      borderBottom: true,
      borderLeft: true,
      borderRight: true,
    });
    expect(borderEdits(origin, 'none').A1).toEqual(edges.B2);
  });

  it('sorts whole selected rows by the anchor column, retaining styles and stable ties', () => {
    const cells = {
      A1: { value: '=B1*2', italic: true },
      B1: { value: '10' },
      A2: { value: '=B2*2', fillColor: '#112233' },
      B2: { value: '2' },
      A3: { value: '=B3*2', bold: true },
      B3: { value: '2' },
    };
    const values = {
      B1: { display: '$10.00', number: 10 },
      B2: { display: '$2.00', number: 2 },
      B3: { display: '$2.00', number: 2 },
    };
    const selection = {
      anchor: { row: 3, column: 1 },
      focus: { row: 0, column: 0 },
    };
    const ascending = sortedRangeCopies(cells, values, selection, false);
    expect(
      ascending
        .filter((copy) => copy.from.column === 0)
        .map((copy) => copy.from.row)
    ).toEqual([1, 2, 0, 3]);
    expect(ascending[0]).toEqual({
      from: { row: 1, column: 0 },
      to: { row: 0, column: 0 },
      cell: { value: '=B2*2', fillColor: '#112233' },
    });
    expect(ascending.at(-1)?.cell).toEqual({ value: '' });
    expect(
      sortedRangeCopies(cells, values, selection, true)
        .filter((copy) => copy.from.column === 0)
        .map((copy) => copy.from.row)
    ).toEqual([0, 1, 2, 3]);
  });

  it('imports BOM, quoted commas, quotes and newlines as a rectangular table', () => {
    const result = csvImportEdits(
      '\uFEFFName,Note\r\n"Smith, Lee","said ""yes""\nnext line"\r\nLast',
      { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } }
    );
    expect(result).toEqual({
      edits: {
        B2: { value: 'Name' },
        C2: { value: 'Note' },
        B3: { value: 'Smith, Lee' },
        C3: { value: 'said "yes"\nnext line' },
        B4: { value: 'Last' },
        C4: { value: '' },
      },
      rowCount: 4,
      selection: {
        anchor: { row: 1, column: 1 },
        focus: { row: 3, column: 2 },
      },
    });
  });

  it('rejects empty, malformed, oversized and overflowing CSV', () => {
    for (const text of [
      '',
      '\uFEFF',
      '"unclosed',
      `first,${'x'.repeat(10_001)}`,
      'x'.repeat(1_000_001),
    ])
      expect(() => csvImportEdits(text, origin)).toThrow();
    const lastCell = {
      anchor: { row: 999, column: 25 },
      focus: { row: 999, column: 25 },
    };
    expect(() => csvImportEdits('one,two', lastCell)).toThrow('fit within');
    expect(() => csvImportEdits('one\ntwo', lastCell)).toThrow('fit within');
    expect(csvImportEdits('fits', lastCell).edits).toEqual({
      Z1000: { value: 'fits' },
    });
  });

  it('finds in visual order and distinguishes displayed values, source formulas and exact case', () => {
    const cells = {
      B2: { value: 'Total' },
      A1: { value: '=SUM(A2:A3)' },
      A3: { value: 'total' },
    };
    const values = { A1: { display: 'Total' } };
    expect(findCells(cells, values, 'total', options)).toEqual([
      'A1',
      'B2',
      'A3',
    ]);
    expect(
      findCells(cells, values, 'Total', {
        ...options,
        entireCell: true,
        matchCase: true,
      })
    ).toEqual(['A1', 'B2']);
    expect(
      findCells(cells, values, 'sum(', { ...options, formulas: true })
    ).toEqual(['A1']);
    expect(findCells(cells, values, 'sum(', options)).toEqual([]);
  });

  it('replaces literal patterns and replacement dollars without regex interpretation', () => {
    expect(replaceCellText('a.b A.B axb', 'a.b', '$&$1', options)).toBe(
      '$&$1 $&$1 axb'
    );
    expect(
      replaceCellText('a.b extra', 'a.b', 'changed', {
        ...options,
        entireCell: true,
      })
    ).toBe('a.b extra');
    expect(
      replaceCellText('A.B', 'a.b', 'changed', { ...options, matchCase: true })
    ).toBe('A.B');
    expect(replaceCellText('hello', '', 'changed', options)).toBe('hello');
  });

  it('trims text without rewriting formulas or formatting', () => {
    expect(
      trimWhitespaceEdits(
        {
          A1: { value: '  a   b\n c  ', bold: true },
          B1: { value: '=SUM( 1,  2 )' },
          C1: { value: '=literal   text  ', format: 'text' },
        },
        { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 2 } }
      )
    ).toEqual({ A1: { value: 'a b\n c' }, C1: { value: '=literal text' } });
  });
});
