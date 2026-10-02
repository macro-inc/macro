import type {
  TableDetail,
  TableVersion,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError } from '../../utils';
import { DatabaseColumn } from './column';
import type { AddColumnOptions, Database } from './database';
import { DatabaseRow } from './row';
import { DatabaseView } from './view';

/**
 * One table (tab) of a {@link Database}.
 *
 * A table is not an entity of its own — it is owned and shared as part of its
 * database, and has no endpoint to read it directly. The handle resolves
 * through {@link Database.schema}, so reads after a write see the new state.
 */
export class DatabaseTable {
  private constructor(
    /** The database this table belongs to. */
    readonly database: Database,
    /** Identifier of the table. */
    readonly id: string
  ) {}

  /** A handle to a table by id, within a database. Details load on first access. */
  static byId(database: Database, id: string): DatabaseTable {
    return new DatabaseTable(database, id);
  }

  /**
   * The table's record as the API returns it: the table, its columns, and
   * its views.
   */
  async detail(): Promise<TableDetail> {
    const { tables } = await this.database.schema();
    const found = tables.find((table) => table.table.id === this.id);
    if (!found) {
      throw new MacroNotFoundError(
        `table ${this.id} is not in database ${this.database.id}`
      );
    }
    return found;
  }

  /** The table's display name. */
  async name(): Promise<string> {
    return (await this.detail()).table.name;
  }

  /** Rename only if the last-read display name is still current. */
  async rename(name: string): Promise<DatabaseTable> {
    await this.database.renameTable(this, name);
    return this;
  }

  /**
   * The table's current version, bumped by every committed change to its
   * schema or rows. Schema edits such as {@link reorderColumns} send it as
   * the base version they were made against, so a table that moved since
   * refuses the edit with a 409.
   */
  async version(): Promise<TableVersion> {
    return (await this.detail()).table.version;
  }

  /** The table's fractional index within the database's tab order. */
  async position(): Promise<string> {
    return (await this.detail()).table.position;
  }

  /** The table's columns, in display order. */
  async columns(): Promise<DatabaseColumn[]> {
    const { columns } = await this.detail();
    return columns.map((column) => DatabaseColumn.byId(this, column.column.id));
  }

  /** Add a column to this table. See {@link Database.addColumn}. */
  addColumn(options: AddColumnOptions): Promise<DatabaseColumn> {
    return this.database.addColumn(this, options);
  }

  /** Persist a new column order. See {@link Database.reorderColumns}. */
  async reorderColumns(columns: DatabaseColumn[]): Promise<DatabaseTable> {
    await this.database.reorderColumns(this, columns);
    return this;
  }

  /** A handle to one of the table's rows, by the id an insert answered. */
  row(id: string): DatabaseRow {
    return DatabaseRow.byId(this, id);
  }

  /** The table's views, in their order. */
  async views(): Promise<DatabaseView[]> {
    const { views } = await this.detail();
    return views.map((view) => DatabaseView.byId(this, view.id));
  }

  /** Delete this table. See {@link Database.deleteTable}. */
  async delete(): Promise<void> {
    await this.database.deleteTable(this);
  }

  toJSON(): { id: string; databaseId: string } {
    return { id: this.id, databaseId: this.database.id };
  }
}
