import { describe, expect, it } from 'vitest';
import { rowsByIdStatement, tableRowsStatement } from './sql';

describe('database row SQL', () => {
  it('uses quoted names verbatim and doubles single quotes in literals', () => {
    expect(rowsByIdStatement('"Guest List"', ['row-2', "row'1"])).toBe(
      "SELECT * FROM \"Guest List\" WHERE row_id IN ('row-2', 'row''1')"
    );
    expect(tableRowsStatement('"Guests"')).toBe(
      'SELECT * FROM "Guests" ORDER BY row_position'
    );
    expect(
      rowsByIdStatement('"Guests"', ["O'Brien's'); DROP TABLE people; --"])
    ).toBe(
      "SELECT * FROM \"Guests\" WHERE row_id IN ('O''Brien''s''); DROP TABLE people; --')"
    );
  });
  it('rejects empty names and empty id lists', () => {
    expect(() => tableRowsStatement('')).toThrow();
    expect(() => rowsByIdStatement('"Guests"', [])).toThrow();
  });
});
