import { describe, expect, it } from 'vitest';
import {
  parseClipboard,
  positionFromAddress,
  safeCsvValue,
  selectionAddresses,
  serializeTable,
} from './grid-selection';

describe('spreadsheet clipboard', () => {
  it('round trips quoted multiline cells, tabs, and quotes', () => {
    const rows = [
      ['name', 'a\tb', 'a"b'],
      ['line\nbreak', '', '42'],
    ];
    expect(parseClipboard(serializeTable(rows))).toEqual(rows);
  });

  it('accepts Windows line endings and a trailing newline', () => {
    expect(parseClipboard('a\tb\r\n1\t2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps blank trailing cells and rejects malformed quoting', () => {
    expect(parseClipboard('a\t\t')).toEqual([['a', '', '']]);
    expect(() => parseClipboard('"unfinished')).toThrow('unclosed');
  });

  it('neutralizes formula-like text in value exports, preserving numbers', () => {
    expect(safeCsvValue('=1+1', false)).toBe("'=1+1");
    expect(safeCsvValue('  @SUM(A1)', false)).toBe("'  @SUM(A1)");
    expect(safeCsvValue('-12', true)).toBe('-12');
  });
});

describe('spreadsheet selection', () => {
  it('normalizes a backwards rectangular selection', () => {
    expect(
      selectionAddresses({
        anchor: { row: 1, column: 1 },
        focus: { row: 0, column: 0 },
      })
    ).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  it('bounds name-box navigation to the MVP sheet', () => {
    expect(positionFromAddress(' z200 ')).toEqual({ row: 199, column: 25 });
    expect(positionFromAddress('A0')).toBeUndefined();
    expect(positionFromAddress('A1001')).toBeUndefined();
    expect(positionFromAddress('AA1')).toBeUndefined();
  });
});
