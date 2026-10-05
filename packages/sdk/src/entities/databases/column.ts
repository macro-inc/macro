import type {
  ColumnCast,
  ColumnConfig,
  ColumnDetail,
  DataType,
  PropertyDefinitionWithOptions,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError } from '../../utils';
import type {
  ChangeColumnTypeOptions,
  ConvertIntoNewColumnOptions,
  InferColumnTypeOptions,
  OpResultOf,
} from './database';
import type { DatabaseTable } from './table';

/**
 * One column of a {@link DatabaseTable}: the placement of a property
 * definition on the table.
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
    readonly id: string
  ) {}

  /** A handle to a column by id, within a table. Details load on first access. */
  static byId(table: DatabaseTable, id: string): DatabaseColumn {
    return new DatabaseColumn(table, id);
  }

  /**
   * The column's record as the API returns it: the placement and the bound
   * property definition.
   */
  async detail(): Promise<ColumnDetail> {
    const { columns } = await this.table.detail();
    const found = columns.find((column) => column.column.id === this.id);
    if (!found) {
      throw new MacroNotFoundError(
        `column ${this.id} is not on table ${this.table.id}`
      );
    }
    return found;
  }

  /** The placement's display name, falling back to its property definition. */
  async name(): Promise<string> {
    const detail = await this.detail();
    return (
      detail.column.display_name ?? detail.definition.definition.display_name
    );
  }

  /**
   * Rename this placement, only if its last-read name is still current,
   * without changing its shared property definition.
   */
  async rename(name: string): Promise<DatabaseColumn> {
    await this.table.database.renameColumn(this, name);
    return this;
  }

  /** Settle the type of an empty column created with inferType enabled. */
  async inferType(options: InferColumnTypeOptions): Promise<DatabaseColumn> {
    await this.table.database.inferColumnType(this, options);
    return this;
  }

  /** Change this column's type. See {@link Database.changeColumnType}. */
  changeType(
    options: ChangeColumnTypeOptions
  ): Promise<OpResultOf<'column', 'type_changed'>> {
    return this.table.database.changeColumnType(this, options);
  }

  /**
   * Add a column of another type right after this one, filled with the
   * values that convert, leaving this one as it is. See
   * {@link Database.convertColumnIntoNewColumn}.
   */
  convertIntoNewColumn(
    options: ConvertIntoNewColumnOptions
  ): Promise<DatabaseColumn> {
    return this.table.database.convertColumnIntoNewColumn(this, options);
  }

  /**
   * What changing this column to each type would do to its values: `safe`,
   * `checked` (with how many would not convert, and a few of them), or
   * `never` (with why). Changes nothing.
   */
  casts(): Promise<ColumnCast[]> {
    return this.table.database.columnCasts(this);
  }

  /** Delete this placement and its cells at the table version last read. */
  async delete(): Promise<void> {
    await this.table.database.deleteColumn(this);
  }

  /** The value type the column holds. */
  async dataType(): Promise<DataType> {
    return (await this.detail()).definition.definition.data_type;
  }

  /** Whether the column holds multiple values. */
  async isMultiSelect(): Promise<boolean> {
    return (await this.detail()).definition.definition.is_multi_select;
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
   * Column-kind configuration (a link), or `undefined` for a plain
   * value column.
   */
  async config(): Promise<ColumnConfig | undefined> {
    return (await this.detail()).column.config ?? undefined;
  }

  /**
   * Add select options to the column. Labels it already has are skipped, so
   * the call is safe to repeat. Only select and tag columns accept options.
   */
  async addOptions(labels: string[]): Promise<DatabaseColumn> {
    await this.table.database.addColumnOptions(this, labels);
    return this;
  }

  toJSON(): { id: string; tableId: string } {
    return { id: this.id, tableId: this.table.id };
  }
}
