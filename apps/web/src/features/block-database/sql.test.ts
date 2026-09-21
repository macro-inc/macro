import { describe, expect, it } from 'vitest';
import {
  deleteRowStatement,
  insertRowStatement,
  updateCellStatement,
} from './sql';

describe('database row SQL', () => {
  it('quotes table, column, row id, and string literals independently', () => {
    expect(
      updateCellStatement({
        tableSqlName: 'a"table',
        columnSqlName: 'a"column',
        rowId: "row'1",
        value: "O'Brien's; DROP TABLE people;",
      })
    ).toBe(
      'UPDATE "a""table" SET "a""column" = \'O\'\'Brien\'\'s; DROP TABLE people;\' WHERE "row_id" = \'row\'\'1\''
    );
    expect(deleteRowStatement({ tableSqlName: 'rows', rowId: "a'b" })).toBe(
      'DELETE FROM "rows" WHERE "row_id" = \'a\'\'b\''
    );
  });
  it('inserts board values without changing SQL types', () => {
    expect(
      insertRowStatement({
        tableSqlName: 'tasks',
        values: { name: "Sam's task", status: 'Done', amount: 0, due: null },
      })
    ).toBe(
      'INSERT INTO "tasks" ("name", "status", "amount", "due") VALUES (\'Sam\'\'s task\', \'Done\', 0, NULL)'
    );
    expect(insertRowStatement({ tableSqlName: 'tasks', values: {} })).toBe(
      'INSERT INTO "tasks" DEFAULT VALUES'
    );
  });
  it('rejects nonfinite numbers and caller-supplied identities', () => {
    expect(() =>
      insertRowStatement({
        tableSqlName: 'tasks',
        values: { amount: Number.NaN },
      })
    ).toThrow();
    expect(() =>
      insertRowStatement({
        tableSqlName: 'tasks',
        values: { amount: Number.POSITIVE_INFINITY },
      })
    ).toThrow();
    expect(() =>
      insertRowStatement({
        tableSqlName: 'tasks',
        values: { row_id: 'user-id' },
      })
    ).toThrow();
  });
});
