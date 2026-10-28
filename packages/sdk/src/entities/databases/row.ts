import type { RowHistoryEntry } from '../../../generated/storage/types.gen';
import type { DatabaseTable } from './table';

/**
 * One row of a {@link DatabaseTable}.
 *
 * A row is not an entity of its own — it is owned and shared as part of its
 * database. Its cells are written with ops; see {@link Database.applyOps}.
 */
export class DatabaseRow {
  private constructor(
    /** The table this row belongs to. */
    readonly table: DatabaseTable,
    /** Identifier of the row. */
    readonly id: string,
  ) {}

  /** A handle to a row by id, within a table. */
  static byId(table: DatabaseTable, id: string): DatabaseRow {
    return new DatabaseRow(table, id);
  }

  /**
   * Every committed change that touched the row, newest first: who made it,
   * when, how, and the values of the columns it touched before and after.
   * A removed row's history still reads.
   */
  history(): Promise<RowHistoryEntry[]> {
    return this.table.database.rowHistory(this);
  }

  toJSON(): { id: string; tableId: string } {
    return { id: this.id, tableId: this.table.id };
  }
}
