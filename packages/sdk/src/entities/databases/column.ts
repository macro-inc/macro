import type {
  ColumnConfig,
  ColumnDetail,
  DataType,
  PropertyDefinitionWithOptions,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError } from '../../utils';
import type { DatabaseTable } from './table';

/**
 * One column of a {@link DatabaseTable}: the placement of a property
 * definition on the table, plus the name the SQL surface exposes it under.
 *
 * A column is not an entity of its own — it has no permissions and no
 * endpoint to read it directly. The handle resolves through the owning
 * database's schema, so a fresh read after a write sees the new value.
 */
export class DatabaseColumn {
  private constructor(
    /** The table this column belongs to. */
    readonly table: DatabaseTable,
    /** Identifier of the column placement. */
    readonly id: string,
  ) {}

  /** A handle to a column by id, within a table. Details load on first access. */
  static byId(table: DatabaseTable, id: string): DatabaseColumn {
    return new DatabaseColumn(table, id);
  }

  /**
   * The column's record as the API returns it: the placement, the bound
   * property definition, its SQL name, and whether SQL may write it.
   */
  async detail(): Promise<ColumnDetail> {
    const { columns } = await this.table.detail();
    const found = columns.find((column) => column.column.id === this.id);
    if (!found) {
      throw new MacroNotFoundError(
        `column ${this.id} is not on table ${this.table.id}`,
      );
    }
    return found;
  }

  /** The column's display name, from its property definition. */
  async name(): Promise<string> {
    return (await this.detail()).definition.definition.display_name;
  }

  /** The name to use for this column in SQL. */
  async sqlName(): Promise<string> {
    return (await this.detail()).sql_name;
  }

  /** The value type the column holds. */
  async dataType(): Promise<DataType> {
    return (await this.detail()).definition.definition.data_type;
  }

  /** Whether the column holds multiple values. */
  async isMultiSelect(): Promise<boolean> {
    return (await this.detail()).definition.definition.is_multi_select;
  }

  /** Whether SQL statements may write this column. */
  async writable(): Promise<boolean> {
    return (await this.detail()).writable;
  }

  /** The column's fractional index within the table's column order. */
  async position(): Promise<string> {
    return (await this.detail()).column.position;
  }

  /**
   * The bound property definition together with its select options — the
   * source of the column's name, type, and allowed values.
   */
  async definition(): Promise<PropertyDefinitionWithOptions> {
    return (await this.detail()).definition;
  }

  /**
   * Column-kind configuration (link or lookup), or `undefined` for a plain
   * value column.
   */
  async config(): Promise<ColumnConfig | undefined> {
    return (await this.detail()).column.config ?? undefined;
  }

  /**
   * Add select options to the column — the labels SQL will accept for it.
   * Labels the column already has are ignored, so the call is safe to
   * repeat. Only select and tag columns accept options.
   *
   * Returns this handle; the owning database's cached schema is dropped, so
   * the next read sees the new options.
   */
  async addOptions(labels: string[]): Promise<DatabaseColumn> {
    await this.table.database.addColumnOptions(this, labels);
    return this;
  }

  toJSON(): { id: string; tableId: string } {
    return { id: this.id, tableId: this.table.id };
  }
}
