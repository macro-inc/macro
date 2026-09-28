import { describe, expect, it } from 'vitest';
import { fillCopies } from './cell-copy';
import { cellAddress } from './grid-selection';
import type { SpreadsheetCells } from './spreadsheet-document';

const vertical = (start: number, end: number, left = 0, right = left) => ({
  anchor: { row: start, column: left },
  focus: { row: end, column: right },
});
function filled(
  cells: SpreadsheetCells,
  source: ReturnType<typeof vertical>,
  target: ReturnType<typeof vertical>,
  mode?: 'series' | 'copy'
) {
  return Object.fromEntries(
    fillCopies(cells, source, target, mode).map(({ to, cell }) => [
      cellAddress(to),
      cell,
    ])
  );
}

describe('smart drag-fill series', () => {
  it('extends independent numeric lanes forward and backward while preserving source styles', () => {
    const cells = {
      A3: { value: '1', bold: true },
      A4: { value: '2' },
      B3: { value: '20' },
      B4: { value: '15' },
    };
    expect(filled(cells, vertical(3, 2, 1, 0), vertical(0, 6, 0, 1))).toEqual({
      A1: { value: '-1', bold: true },
      B1: { value: '30' },
      A2: { value: '0' },
      B2: { value: '25' },
      A5: { value: '3', bold: true },
      B5: { value: '10' },
      A6: { value: '4' },
      B6: { value: '5' },
      A7: { value: '5', bold: true },
      B7: { value: '0' },
    });
    expect(cells.A3.value).toBe('1');
  });

  it('fills horizontal decimal steps without exposing floating-point artifacts', () => {
    expect(
      filled(
        { B1: { value: '0.1' }, C1: { value: '0.2' } },
        vertical(0, 0, 1, 2),
        vertical(0, 0, 0, 5)
      )
    ).toEqual({
      A1: { value: '0' },
      D1: { value: '0.3' },
      E1: { value: '0.4' },
      F1: { value: '0.5' },
    });
  });

  it('repeats a lone number, explicit text, formulas, blanks and non-arithmetic patterns', () => {
    const cells: SpreadsheetCells = {
      A1: { value: '5' },
      B1: { value: '1', format: 'text' },
      B2: { value: '2', format: 'text' },
      C1: { value: '=B1' },
      C2: { value: '=B2' },
      D1: { value: '1' },
      D2: { value: '3' },
      D3: { value: '4' },
    };
    expect(filled(cells, vertical(0, 0), vertical(0, 2)).A3.value).toBe('5');
    expect(filled(cells, vertical(0, 1, 1, 2), vertical(0, 3, 1, 2))).toEqual({
      B3: { value: '1', format: 'text' },
      C3: { value: '=B1' },
      B4: { value: '2', format: 'text' },
      C4: { value: '=B2' },
    });
    expect(filled(cells, vertical(0, 2, 3), vertical(0, 4, 3)).D5.value).toBe(
      '3'
    );
    expect(filled(cells, vertical(0, 1), vertical(0, 3)).A3.value).toBe('5');
  });

  it('advances daily and weekly dates, including leap years and reverse drags', () => {
    expect(
      filled({ A2: { value: '2024-02-28' } }, vertical(1, 1), vertical(0, 3))
    ).toEqual({
      A1: { value: '2024-02-27' },
      A3: { value: '2024-02-29' },
      A4: { value: '2024-03-01' },
    });
    expect(
      filled(
        { A1: { value: '9/1/2026' }, A2: { value: '9/8/2026' } },
        vertical(0, 1),
        vertical(0, 3)
      ).A4.value
    ).toBe('9/22/2026');
  });

  it('continues month ends and quarterly imported financial dates without drifting', () => {
    expect(
      filled(
        { A1: { value: '2024-01-31' }, A2: { value: '2024-02-29' } },
        vertical(0, 1),
        vertical(0, 3)
      )
    ).toEqual({
      A3: { value: '2024-03-31' },
      A4: { value: '2024-04-30' },
    });
    const serial = (value: string) =>
      String(
        (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000
      );
    const cells = {
      A1: { value: serial('2026-03-31'), numberFormat: 'mmm-yy' },
      A2: { value: serial('2026-06-30'), numberFormat: 'mmm-yy' },
    };
    expect(filled(cells, vertical(0, 1), vertical(0, 3))).toEqual({
      A3: { value: serial('2026-09-30'), numberFormat: 'mmm-yy' },
      A4: { value: serial('2026-12-31'), numberFormat: 'mmm-yy' },
    });
  });

  it('does not infer invalid dates or non-finite numbers and keeps explicit fill-copy commands literal', () => {
    for (const value of ['2026-02-30', '1e999', "'12", '=1+1']) {
      expect(
        filled({ A1: { value } }, vertical(0, 0), vertical(0, 1)).A2.value
      ).toBe(value);
    }
    expect(
      filled(
        { A1: { value: '2026-09-01' } },
        vertical(0, 0),
        vertical(0, 1),
        'copy'
      ).A2.value
    ).toBe('2026-09-01');
    expect(
      filled(
        { A1: { value: '1' }, A2: { value: '2' } },
        vertical(0, 1),
        vertical(0, 3),
        'copy'
      ).A3.value
    ).toBe('1');
  });
});
