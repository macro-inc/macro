import type {
  TableDetail,
  TableVersion,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError } from '../../utils';
import { DatabaseColumn } from './column';
import type { AddColumnOptions, Database } from './database';

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
   * The table's record as the API returns it: the table, its columns, and the
   * name the SQL surface exposes it under.
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

  /** The name to use for this table in SQL (`FROM guests`). */
  async sqlName(): Promise<string> {
    return (await this.detail()).sql_name;
  }

  /** Stable read-only SQL alias that survives table renames. */
  async readSqlName(): Promise<string> {
    return (await this.detail()).read_sql_name;
  }

  /** Rename only if the last-read display name is still current. */
  async rename(name: string): Promise<DatabaseTable> {
    await this.database.renameTable(this, name);
    return this;
  }

  /**
   * The table's current version, bumped on every row, column, and link
   * mutation. Pass it as a base version to {@link Database.exec} for a
   * compare-and-set write.
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
  addColumn(opts: AddColumnOptions): Promise<DatabaseColumn> {
    return this.database.addColumn(this, opts);
  }

  /** Persist every column ID exactly once in the requested order. */
  async reorderColumns(
    columnIds: string[],
    baseVersion: TableVersion
  ): Promise<DatabaseTable> {
    await this.database.reorderColumns(this, columnIds, baseVersion);
    return this;
  }

  toJSON(): { id: string; databaseId: string } {
    return { id: this.id, databaseId: this.database.id };
  }
}
