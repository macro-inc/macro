import { match, P } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import type {
  ApplyOpsRequest,
  CardPosition,
  ColumnCast,
  ColumnConversion,
  ColumnKind,
  DatabaseDetail,
  DatabaseOp,
  DatabaseTemplate,
  DatabaseTemplateId,
  EntityKind,
  ImportTable,
  InferColumnTypeOutcome,
  InferColumnTypeRequest,
  NewColumn,
  NewOption,
  OpRefusalResponse,
  OpResult,
  RowHistoryEntry,
  SharePermissionV2,
  TableVersion,
  TakenId,
  UpdateSharePermissionRequestV2,
} from '../../../generated/storage/types.gen';
import { MacroApiError, MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { PropertyDefinition } from '../properties/property-definition';
import { User } from '../users/user';
import { DatabaseColumn } from './column';
import type { DatabaseRow } from './row';
import { DatabaseTable } from './table';
import type { DatabaseView } from './view';

/** A result naming what happened to its resource: every kind but a reorder of the database's tables. */
type ChangedResult = Extract<OpResult, { change: unknown }>;

/** What a result of each op kind can say happened. */
type ResultChanges = {
  [Kind in ChangedResult['kind']]: Extract<
    ChangedResult,
    { kind: Kind }
  >['change']['kind'];
};

/** The result of a `Kind` op whose change answered `Change`. */
export type OpResultOf<
  Kind extends keyof ResultChanges,
  Change extends ResultChanges[Kind],
> = Extract<ChangedResult, { kind: Kind }> & {
  change: Extract<
    Extract<ChangedResult, { kind: Kind }>['change'],
    { kind: Change }
  >;
};

/**
 * A type a column can have. A relation names the related table by handle;
 * the table may live in any database the caller can reach.
 */
export type ColumnType =
  | Exclude<ColumnKind, { type: 'relation' }>
  | { type: 'relation'; table: DatabaseTable };

/** Options for {@link Database.addColumn}. */
export type AddColumnOptions = (
  | {
      /** Display name of the column, unique within the table ignoring case. */
      name: string;
      /** What the column holds. */
      type: ColumnType;
      /**
       * For a select or tag column, the labels it starts with. Without any it
       * accepts nothing until {@link DatabaseColumn.addOptions} adds some.
       */
      options?: string[];
      /** Let a plain, empty text column settle its type from its first value. */
      inferType?: boolean;
    }
  | {
      /** An existing property definition to bind the column to. */
      property: PropertyDefinition;
    }
) & {
  /** The column the new one goes right after; by default, the last one. */
  after?: DatabaseColumn;
};

/** Options for {@link Database.create}. */
export type CreateDatabaseOptions = {
  /** Display name of the database. */
  name: string;
  /**
   * The template that builds it, with its tables, columns, views and sample
   * rows; by default it starts blank, with one table holding a Name column.
   */
  template?: DatabaseTemplateId;
};

/** Options for {@link Database.changeColumnType}. */
export type ChangeColumnTypeOptions = {
  /** The type to change the column to. */
  to: ColumnType;
};

/** Options for {@link Database.convertColumnIntoNewColumn}. */
export type ConvertIntoNewColumnOptions = {
  /** The type of the new column. */
  to: ColumnType;
  /**
   * Display name of the new column; by default the original's name followed
   * by the type, as in `Due (Date)`.
   */
  name?: string;
};

/** Options for {@link Database.applyOps}. */
export type ApplyOpsOptions = {
  /**
   * The version each table must still be at, as the caller read it. A table
   * that moved refuses the whole batch with a 409, so an edit made against
   * what the caller saw does not overwrite another's.
   */
  baseVersions?: { table: DatabaseTable; version: TableVersion }[];
};

/** Settle an empty inferred column using the table version the caller read. */
export type InferColumnTypeOptions = {
  dataType: 'STRING' | 'NUMBER' | 'ENTITY';
  specificEntityType?: InferColumnTypeRequest['specificEntityType'];
  baseVersion: TableVersion;
};

/**
 * A batch of ops was refused (HTTP 400): nothing in it was written. Names the
 * op at fault and, when the batch minted an id that already names something
 * (a retry of a batch that committed, or an id minted twice), that id.
 */
export class MacroOpRefusedError extends MacroApiError {
  /** The refused op's index in the batch. */
  readonly op: number;
  /** The row's index within the op, when one row is at fault. */
  readonly row: number | null;
  /** The column placement at fault, when one is. */
  readonly column: string | null;
  /** The minted id that is already taken, when that is the reason. */
  readonly taken: TakenId | null;

  constructor(status: number, refusal: OpRefusalResponse) {
    super(status, refusal);
    this.name = 'MacroOpRefusedError';
    this.message = refusal.message;
    this.op = refusal.op;
    this.row = refusal.row;
    this.column = refusal.column;
    this.taken = refusal.taken;
  }
}

function columnKind(type: ColumnType): ColumnKind {
  return match(type)
    .with({ type: 'relation' }, ({ table }) => ({
      type: 'relation' as const,
      database: table.database.id,
      table: table.id,
    }))
    .with({ type: P.not('relation') }, (plain) => plain)
    .exhaustive();
}

const entityLabels: Record<EntityKind, string> = {
  USER: 'People',
  DOCUMENT: 'Documents',
  TASK: 'Tasks',
  COMPANY: 'Companies',
  CONTACT: 'Contacts',
  CALL_RECORD: 'Calls',
  CHANNEL: 'Channels',
  CHAT: 'Chats',
  PROJECT: 'Projects',
  THREAD: 'Emails',
  CALENDAR_EVENT: 'Events',
  INITIATIVE: 'Initiatives',
};

/** The name a type goes by in the app's type menu. */
function typeLabel(type: ColumnType): string {
  return match(type)
    .with({ type: 'text' }, () => 'Text')
    .with({ type: 'number' }, () => 'Number')
    .with({ type: 'boolean' }, () => 'Checkbox')
    .with({ type: 'date' }, () => 'Date')
    .with({ type: 'link' }, () => 'URL')
    .with({ type: 'select', multi: true }, () => 'Multi-select')
    .with({ type: 'select', multi: false }, () => 'Select')
    .with({ type: 'select_number', multi: true }, () => 'Multi-number select')
    .with({ type: 'select_number', multi: false }, () => 'Number select')
    .with({ type: 'tag' }, () => 'Tag')
    .with({ type: 'entity' }, ({ target }) => entityLabels[target])
    .with({ type: 'relation' }, () => 'Relation')
    .exhaustive();
}

function newOptions(labels: string[]): NewOption[] {
  return labels.map((label) => ({ id: uuidv7(), label }));
}

function isResultOf<
  Kind extends keyof ResultChanges,
  Change extends ResultChanges[Kind],
>(
  result: OpResult | undefined,
  kind: Kind,
  change: Change
): result is OpResultOf<Kind, Change> {
  return (
    result?.kind === kind && 'change' in result && result.change.kind === change
  );
}

/** A result as `kind.change`, for an error naming what came back. */
function resultName(result: OpResult): string {
  return match(result)
    .with({ kind: 'reorder_tables' }, ({ kind }) => kind)
    .with(
      { kind: P.union('table', 'column', 'rows', 'view') },
      ({ kind, change }) => `${kind}.${change.kind}`
    )
    .exhaustive();
}

/** The one result of a one-op batch, which must be what the op answers. */
function soleResult<
  Kind extends keyof ResultChanges,
  Change extends ResultChanges[Kind],
>(results: OpResult[], kind: Kind, change: Change): OpResultOf<Kind, Change> {
  const [result] = results;
  if (results.length !== 1 || !isResultOf(result, kind, change))
    throw new MacroError(
      `expected one ${kind}.${change} result, got ${results.map(resultName).join(', ') || 'none'}`
    );
  return result;
}

/**
 * A Macro database: a named collection of tables, owned and shared as one
 * entity.
 *
 * A free-to-construct `(client, id)` handle like any other entity — the schema
 * loads lazily on first field access and is dropped after any mutation.
 */
export class Database extends MacroEntity<DatabaseDetail> {
  protected async fetch(): Promise<DatabaseDetail> {
    return unwrap(
      await this.client.storage.getDatabase({ path: { id: this.id } })
    );
  }

  private assertOwns(part: string, owner: Database): void {
    if (owner.id !== this.id)
      throw new MacroError(`${part} does not belong to database ${this.id}`);
  }

  /** A handle to a database by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Database {
    return new Database(client, id);
  }

  /** Create a database owned by the caller. */
  static async create(
    client: MacroClient,
    options: CreateDatabaseOptions
  ): Promise<Database> {
    const record = unwrap(
      await client.storage.createDatabase({
        body: { name: options.name, template: options.template },
      })
    );
    return new Database(client, record.id);
  }

  /** The templates a database can be created from, in the order a picker lists them. */
  static async templates(client: MacroClient): Promise<DatabaseTemplate[]> {
    return unwrap(await client.storage.listDatabaseTemplates());
  }

  /** The databases the caller can see, each with the caller's access level. */
  static async list(client: MacroClient): Promise<Database[]> {
    const listed = unwrap(await client.storage.listDatabases());
    return listed.map((entry) => new Database(client, entry.database.id));
  }

  /**
   * The full schema: the database record, the caller's access, and every
   * table with its columns and views. Cached until the next write.
   */
  schema(): Promise<DatabaseDetail> {
    return this.detail.get();
  }

  /** The database's display name. */
  readonly name = this.mappedField('database', (record) => record.name);

  /** The user who owns the database. */
  readonly owner = this.mappedField('database', (record) =>
    User.byId(this.client, record.owner_id)
  );

  /** When the database was created. */
  readonly createdAt = this.mappedField(
    'database',
    (record) => record.created_at
  );

  /** When the database was trashed, if it has been. */
  readonly trashedAt = this.mappedField(
    'database',
    (record) => record.trashed_at ?? undefined
  );

  /** The caller's access on the database. */
  readonly grant = this.field('grant');

  /** The database's tables, in tab order. */
  readonly tables = this.mappedField('tables', (tables) =>
    tables.map((table) => DatabaseTable.byId(this, table.table.id))
  );

  /** The table with the given display name, or `undefined` if there is none. */
  async table(name: string): Promise<DatabaseTable | undefined> {
    const { tables } = await this.schema();
    const found = tables.find((table) => table.table.name === name);
    return found ? DatabaseTable.byId(this, found.table.id) : undefined;
  }

  /** Create a table in the database, under an id minted here. */
  async createTable(options: { name: string }): Promise<DatabaseTable> {
    const { table } = soleResult(
      await this.applyOps([
        {
          kind: 'table',
          table: uuidv7(),
          change: { kind: 'create', name: options.name },
        },
      ]),
      'table',
      'created'
    );
    return DatabaseTable.byId(this, table);
  }

  /**
   * Apply ops to the database in one transaction: create, rename, reorder,
   * or delete tables and columns; change a column's type; add, edit, or
   * delete select options; insert, update, or delete rows; create, change,
   * reorder, or delete views; move board cards. Later ops see what earlier
   * ones did, so a table or column created by one op (under an id the caller
   * mints, as a UUIDv7) can be named by the next. A refused op leaves the
   * whole batch unwritten and throws {@link MacroOpRefusedError}. Returns one
   * result per op, in the order sent.
   */
  async applyOps(
    ops: DatabaseOp[],
    options: ApplyOpsOptions = {}
  ): Promise<OpResult[]> {
    const body: ApplyOpsRequest = { ops };
    if (options.baseVersions !== undefined) {
      for (const { table } of options.baseVersions)
        this.assertOwns(`table ${table.id}`, table.database);
      body.baseVersions = Object.fromEntries(
        options.baseVersions.map(({ table, version }) => [table.id, version])
      );
    }
    const { results } = await this.mutate(async (client) => {
      const outcome = await client.storage.applyDatabaseOps({
        path: { id: this.id },
        body,
      });
      if (outcome.error !== undefined && 'op' in outcome.error)
        throw new MacroOpRefusedError(
          outcome.response?.status ?? 0,
          outcome.error
        );
      return outcome;
    });
    return results;
  }

  /**
   * Persist a new tab order. Pass every table of the database exactly once.
   * Returns the tables in their new order.
   */
  async reorderTables(tables: DatabaseTable[]): Promise<DatabaseTable[]> {
    for (const table of tables)
      this.assertOwns(`table ${table.id}`, table.database);
    const results = await this.applyOps([
      { kind: 'reorder_tables', order: tables.map((table) => table.id) },
    ]);
    const [reordered] = results;
    if (results.length !== 1 || reordered?.kind !== 'reorder_tables')
      throw new MacroError(
        `expected one reorder_tables result, got ${results.map(resultName).join(', ') || 'none'}`
      );
    return reordered.tables.map(({ table }) => DatabaseTable.byId(this, table));
  }

  /**
   * Delete one of the database's tables with its columns, rows, and views.
   * A database keeps at least one table, and a table another table's
   * relation column points at cannot be deleted.
   */
  async deleteTable(table: DatabaseTable): Promise<void> {
    this.assertOwns(`table ${table.id}`, table.database);
    soleResult(
      await this.applyOps([
        { kind: 'table', table: table.id, change: { kind: 'delete' } },
      ]),
      'table',
      'deleted'
    );
  }

  /**
   * What changing a column to each type would do to its values. Changes
   * nothing.
   */
  async columnCasts(column: DatabaseColumn): Promise<ColumnCast[]> {
    this.assertOwns(`column ${column.id}`, column.table.database);
    return unwrap(
      await this.client.storage.listDatabaseColumnCasts({
        path: { id: this.id, table_id: column.table.id, column_id: column.id },
      })
    );
  }

  /** Where a board view's cards sit: each placed card's lane and key. */
  async viewPositions(view: DatabaseView): Promise<CardPosition[]> {
    this.assertOwns(`view ${view.id}`, view.table.database);
    const { positions } = unwrap(
      await this.client.storage.getDatabaseViewPositions({
        path: { id: this.id, view_id: view.id },
      })
    );
    return positions;
  }

  /**
   * A row's history: every committed change that touched it, newest first.
   * See {@link DatabaseRow.history}.
   */
  async rowHistory(row: DatabaseRow): Promise<RowHistoryEntry[]> {
    this.assertOwns(`row ${row.id}`, row.table.database);
    const { changes } = unwrap(
      await this.client.storage.getDatabaseRowHistory({
        path: { id: this.id, table_id: row.table.id, row_id: row.id },
      })
    );
    return changes;
  }

  /** Import text rows atomically. Keep requestId unchanged when retrying. */
  async importTable(request: ImportTable): Promise<DatabaseTable> {
    const table = await this.mutate((client) =>
      client.storage.importDatabaseTable({
        path: { id: this.id },
        body: request,
      })
    );
    return DatabaseTable.byId(this, table.id);
  }

  /** Read direct recipients. Only the database owner can manage sharing. */
  async sharePermissions(): Promise<SharePermissionV2> {
    return unwrap(
      await this.client.storage.getDatabasePermissions({
        path: { id: this.id },
      })
    );
  }

  /** Add, replace, or remove recipient grants without transferring ownership. */
  updateSharePermissions(
    request: UpdateSharePermissionRequestV2
  ): Promise<SharePermissionV2> {
    return this.mutate((client) =>
      client.storage.updateDatabasePermissions({
        path: { id: this.id },
        body: request,
      })
    );
  }

  /**
   * Change a column's type at the table version last read. Every value must
   * convert: one that does not refuses the change, naming how many and a few
   * of them, and nothing is written. To keep the original column, see
   * {@link Database.convertColumnIntoNewColumn}.
   */
  async changeColumnType(
    column: DatabaseColumn,
    options: ChangeColumnTypeOptions
  ): Promise<OpResultOf<'column', 'type_changed'>> {
    this.assertOwns(`column ${column.id}`, column.table.database);
    const version = await column.table.version();
    return soleResult(
      await this.applyOps(
        [
          {
            kind: 'column',
            table: column.table.id,
            column: column.id,
            change: { kind: 'change_type', to: columnKind(options.to) },
          },
        ],
        { baseVersions: [{ table: column.table, version }] }
      ),
      'column',
      'type_changed'
    );
  }

  /**
   * What a column's values become under another type: the values that
   * convert, the option labels a new select or tag column of that type needs,
   * and how many values do not convert. Changes nothing.
   */
  async columnConversion(
    column: DatabaseColumn,
    to: ColumnType
  ): Promise<ColumnConversion> {
    this.assertOwns(`column ${column.id}`, column.table.database);
    return unwrap(
      await this.client.storage.convertDatabaseColumn({
        path: { id: this.id, table_id: column.table.id, column_id: column.id },
        body: { to: columnKind(to) },
      })
    );
  }

  /**
   * Add a column of another type right after this one, filled with the
   * values that convert, in one batch at the table version the conversion
   * was read at. The original column is left as it is; values that do not
   * convert stay only there.
   */
  async convertColumnIntoNewColumn(
    column: DatabaseColumn,
    options: ConvertIntoNewColumnOptions
  ): Promise<DatabaseColumn> {
    const conversion = await this.columnConversion(column, options.to);
    const name =
      options.name ?? `${await column.name()} (${typeLabel(options.to)})`;
    const id = uuidv7();
    const ops: DatabaseOp[] = [
      {
        kind: 'column',
        table: column.table.id,
        column: id,
        change: {
          kind: 'create',
          definition: {
            source: 'new',
            name,
            type: columnKind(options.to),
            options: newOptions(conversion.options),
          },
          after: column.id,
        },
      },
    ];
    if (conversion.cells.length > 0)
      ops.push({
        kind: 'rows',
        table: column.table.id,
        change: {
          kind: 'update',
          changes: {
            kind: 'per_row',
            rows: conversion.cells.map(({ row, value }) => ({
              row,
              cells: [{ column: id, value }],
            })),
          },
        },
      });
    const [created] = await this.applyOps(ops, {
      baseVersions: [{ table: column.table, version: conversion.tableVersion }],
    });
    if (!isResultOf(created, 'column', 'created'))
      throw new MacroError(
        `expected a column.created result, got ${created ? resultName(created) : 'none'}`
      );
    return DatabaseColumn.byId(column.table, created.column);
  }

  /**
   * Remove a column and its cells at the table version last read. Returns
   * the table's new version.
   */
  async deleteColumn(column: DatabaseColumn): Promise<TableVersion> {
    this.assertOwns(`column ${column.id}`, column.table.database);
    const version = await column.table.version();
    const { tableVersion } = soleResult(
      await this.applyOps(
        [
          {
            kind: 'column',
            table: column.table.id,
            column: column.id,
            change: { kind: 'delete' },
          },
        ],
        { baseVersions: [{ table: column.table, version }] }
      ),
      'column',
      'deleted'
    );
    return tableVersion;
  }

  /**
   * Persist a complete column order at the table version last read. Pass
   * every column of the table exactly once.
   * Returns the table's new version.
   */
  async reorderColumns(
    table: DatabaseTable,
    columns: DatabaseColumn[]
  ): Promise<TableVersion> {
    this.assertOwns(`table ${table.id}`, table.database);
    for (const column of columns)
      if (column.table.id !== table.id)
        throw new MacroError(
          `column ${column.id} does not belong to table ${table.id}`
        );
    const version = await table.version();
    const { tableVersion } = soleResult(
      await this.applyOps(
        [
          {
            kind: 'table',
            table: table.id,
            change: {
              kind: 'reorder_columns',
              order: columns.map((column) => column.id),
            },
          },
        ],
        { baseVersions: [{ table, version }] }
      ),
      'table',
      'columns_reordered'
    );
    if (tableVersion === undefined)
      throw new MacroError(
        `table ${table.id} reordered its columns without a version`
      );
    return tableVersion;
  }

  /**
   * Rename a table only if its last-read name is still current. Returns the
   * table's new version.
   */
  async renameTable(table: DatabaseTable, name: string): Promise<TableVersion> {
    this.assertOwns(`table ${table.id}`, table.database);
    const previousName = await table.name();
    const { tableVersion } = soleResult(
      await this.applyOps([
        {
          kind: 'table',
          table: table.id,
          change: { kind: 'rename', name, previousName },
        },
      ]),
      'table',
      'renamed'
    );
    if (tableVersion === undefined)
      throw new MacroError(`table ${table.id} was renamed without a version`);
    return tableVersion;
  }

  /**
   * Rename this column placement, only if its last-read name is still
   * current, without changing its shared property definition. Returns the
   * table's new version.
   */
  async renameColumn(
    column: DatabaseColumn,
    name: string
  ): Promise<TableVersion> {
    this.assertOwns(`column ${column.id}`, column.table.database);
    const previousName = await column.name();
    const { tableVersion } = soleResult(
      await this.applyOps([
        {
          kind: 'column',
          table: column.table.id,
          column: column.id,
          change: { kind: 'rename', name, previousName },
        },
      ]),
      'column',
      'renamed'
    );
    return tableVersion;
  }

  /** Adopt a first-value type only while the owned column is empty and inferable. */
  async inferColumnType(
    column: DatabaseColumn,
    options: InferColumnTypeOptions
  ): Promise<InferColumnTypeOutcome> {
    this.assertOwns(`column ${column.id}`, column.table.database);
    return this.mutate((client) =>
      client.storage.inferDatabaseColumnType({
        path: { id: this.id, table_id: column.table.id, column_id: column.id },
        body: {
          dataType: options.dataType,
          baseVersion: options.baseVersion,
          ...(options.specificEntityType !== undefined
            ? { specificEntityType: options.specificEntityType }
            : {}),
        },
      })
    );
  }

  /**
   * Add a column to one of the database's tables, under an id minted here,
   * either creating a property definition for it or binding an existing one.
   */
  async addColumn(
    table: DatabaseTable,
    options: AddColumnOptions
  ): Promise<DatabaseColumn> {
    this.assertOwns(`table ${table.id}`, table.database);
    if (options.after !== undefined && options.after.table.id !== table.id)
      throw new MacroError(
        `column ${options.after.id} does not belong to table ${table.id}`
      );
    const definition: NewColumn =
      'property' in options
        ? { source: 'existing', property: options.property.id }
        : {
            source: 'new',
            name: options.name,
            type: columnKind(options.type),
            ...(options.options !== undefined
              ? { options: newOptions(options.options) }
              : {}),
            ...(options.inferType !== undefined
              ? { inferType: options.inferType }
              : {}),
          };
    const { column } = soleResult(
      await this.applyOps([
        {
          kind: 'column',
          table: table.id,
          column: uuidv7(),
          change: {
            kind: 'create',
            definition,
            ...(options.after !== undefined ? { after: options.after.id } : {}),
          },
        },
      ]),
      'column',
      'created'
    );
    return DatabaseColumn.byId(table, column);
  }

  /**
   * Add select options to one of the database's columns, each under an id
   * minted here. Labels the column already has are skipped, so the call is
   * safe to repeat; the result lists the options it did create. Only select
   * and tag columns accept options.
   */
  async addColumnOptions(
    column: DatabaseColumn,
    labels: string[]
  ): Promise<OpResultOf<'column', 'options_added'>> {
    this.assertOwns(`column ${column.id}`, column.table.database);
    return soleResult(
      await this.applyOps([
        {
          kind: 'column',
          table: column.table.id,
          column: column.id,
          change: { kind: 'add_options', options: newOptions(labels) },
        },
      ]),
      'column',
      'options_added'
    );
  }
}
