import type {
  ChangeColumnTypeRequest,
  ColumnDetail,
  ColumnSchemaOutcome,
  CreateColumnRequest,
  DatabaseDetail,
  DatabaseSharePermissions,
  DataType,
  ExecOutcome,
  ImportTable,
  InferColumnTypeOutcome,
  InferColumnTypeRequest,
  QueryResult,
  TableVersion,
  UpdateDatabasePermissionsRequest,
} from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { PropertyDefinition } from '../properties/property-definition';
import { User } from '../users/user';
import { DatabaseColumn } from './column';
import { DatabaseTable } from './table';

/** How a new column obtains the property definition behind it. */
export type ColumnBinding =
  | {
      /** Display name of the column, and of the definition created for it. */
      name: string;
      /** The value type the column holds. */
      dataType: DataType;
      /** Whether the column holds multiple values. Defaults to false. */
      multiSelect?: boolean;
      /**
       * For a select or tag column, the labels SQL will accept. A select
       * column created without any accepts nothing until options are added
       * with {@link DatabaseColumn.addOptions}.
       */
      options?: string[];
    }
  | {
      /** An existing property definition to bind the column to. */
      property: PropertyDefinition;
    };

/** Options for {@link Database.addColumn}. */
export type AddColumnOptions = ColumnBinding & {
  /** Allow a newly owned, empty text column to infer its first value's type. */
  inferType?: boolean;
  /**
   * Make this a link column pointing at another table (many-to-many). The
   * target may live in any database the caller can reach.
   */
  linkTo?: DatabaseTable;
};

/** Settle an empty inferred column using the table version the caller read. */
export type InferColumnTypeOptions = {
  dataType: 'STRING' | 'NUMBER' | 'ENTITY';
  specificEntityType?: InferColumnTypeRequest['specific_entity_type'];
  baseVersion: TableVersion;
};

/** Options for {@link Database.exec} and {@link DatabaseNamespace.exec}. */
export interface ExecOptions {
  /** The statements to run, executed in one transaction. */
  sql: string;
  /**
   * Compare-and-swap by table id: the write is rejected with a 409 if
   * a listed table being written has moved past the given version. Read-only
   * dependencies are not guarded. Omit for cell-level last-write-wins. Versions
   * come from {@link DatabaseTable.version} or an outcome's `read_versions`.
   */
  baseVersions?: Record<string, TableVersion>;
}

/**
 * A Macro database: a named collection of tables, owned and shared as one
 * entity, and queryable with SQL.
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

  /** A handle to a database by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Database {
    return new Database(client, id);
  }

  /** Create a database owned by the caller. */
  static async create(
    client: MacroClient,
    opts: { name: string }
  ): Promise<Database> {
    const record = unwrap(
      await client.storage.createDatabase({ body: { name: opts.name } })
    );
    return new Database(client, record.id);
  }

  /** The databases the caller can see, each with the caller's access level. */
  static async list(client: MacroClient): Promise<Database[]> {
    const listed = unwrap(await client.storage.listDatabases());
    return listed.map((entry) => new Database(client, entry.database.id));
  }

  /**
   * Run SQL against every database the caller can reach, in one transaction.
   * Tables are addressed by their SQL names ({@link DatabaseTable.sqlName}),
   * so a statement may join across databases.
   */
  static async exec(
    client: MacroClient,
    opts: ExecOptions
  ): Promise<ExecOutcome> {
    return unwrap(
      await client.storage.execDatabaseSql({
        body: {
          sql: opts.sql,
          ...(opts.baseVersions !== undefined
            ? { baseVersions: opts.baseVersions }
            : {}),
        },
      })
    );
  }

  /** Read SQL through the server-enforced read-only endpoint. */
  static async query(client: MacroClient, sql: string): Promise<ExecOutcome> {
    return unwrap(await client.storage.queryDatabaseSql({ body: { sql } }));
  }

  /**
   * The full schema: the database record, the caller's access, and every
   * table with its columns and SQL names. Cached until the next write.
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

  /** Create a table in the database. */
  async createTable(opts: { name: string }): Promise<DatabaseTable> {
    const table = await this.mutate((c) =>
      c.storage.createDatabaseTable({
        path: { id: this.id },
        body: { name: opts.name },
      })
    );
    return DatabaseTable.byId(this, table.id);
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
  async sharePermissions(): Promise<DatabaseSharePermissions> {
    return unwrap(
      await this.client.storage.getDatabasePermissions({
        path: { id: this.id },
      })
    );
  }

  /** Add, replace, or remove recipient grants without transferring ownership. */
  updateSharePermissions(
    request: UpdateDatabasePermissionsRequest
  ): Promise<DatabaseSharePermissions> {
    return this.mutate((client) =>
      client.storage.updateDatabasePermissions({
        path: { id: this.id },
        body: request,
      })
    );
  }

  /** Change one placement's type only when all existing values convert safely. */
  async changeColumnType(
    column: DatabaseColumn,
    request: ChangeColumnTypeRequest
  ): Promise<ColumnSchemaOutcome> {
    if (column.table.database.id !== this.id)
      throw new MacroError(
        `column ${column.id} does not belong to database ${this.id}`
      );
    return this.mutate((client) =>
      client.storage.changeDatabaseColumnType({
        path: { id: this.id, table_id: column.table.id, column_id: column.id },
        body: request,
      })
    );
  }

  /** Remove a column and its cells, guarded by the table version last read. */
  async deleteColumn(
    column: DatabaseColumn,
    baseVersion: TableVersion
  ): Promise<ColumnSchemaOutcome> {
    if (column.table.database.id !== this.id)
      throw new MacroError(
        `column ${column.id} does not belong to database ${this.id}`
      );
    return this.mutate((client) =>
      client.storage.deleteDatabaseColumn({
        path: { id: this.id, table_id: column.table.id, column_id: column.id },
        body: { baseVersion },
      })
    );
  }

  /** Persist a complete column order, including currently hidden columns. */
  async reorderColumns(
    table: DatabaseTable,
    columnIds: string[],
    baseVersion: TableVersion
  ): Promise<ColumnSchemaOutcome> {
    if (table.database.id !== this.id)
      throw new MacroError(
        `table ${table.id} does not belong to database ${this.id}`
      );
    return this.mutate((client) =>
      client.storage.reorderDatabaseColumns({
        path: { id: this.id, table_id: table.id },
        body: { columnIds, baseVersion },
      })
    );
  }

  /** Rename a table only if its last-read name is still current. */
  async renameTable(table: DatabaseTable, name: string): Promise<void> {
    if (table.database.id !== this.id) {
      throw new MacroError(
        `table ${table.id} does not belong to database ${this.id}`
      );
    }
    const previousName = await table.name();
    await this.mutate((client) =>
      client.storage.renameDatabaseTable({
        path: { id: this.id, table_id: table.id },
        body: { name, previousName },
      })
    );
  }

  /** Rename this column placement without changing shared definitions or SQL names. */
  async renameColumn(column: DatabaseColumn, name: string): Promise<void> {
    if (column.table.database.id !== this.id) {
      throw new MacroError(
        `column ${column.id} does not belong to database ${this.id}`
      );
    }
    const previousName = await column.name();
    await this.mutate((client) =>
      client.storage.renameDatabaseColumn({
        path: { id: this.id, table_id: column.table.id, column_id: column.id },
        body: { name, previousName },
      })
    );
  }

  /** Adopt a first-value type only while the owned column is empty and inferable. */
  async inferColumnType(
    column: DatabaseColumn,
    opts: InferColumnTypeOptions
  ): Promise<InferColumnTypeOutcome> {
    if (column.table.database.id !== this.id) {
      throw new MacroError(
        `column ${column.id} does not belong to database ${this.id}`
      );
    }
    return this.mutate((client) =>
      client.storage.inferDatabaseColumnType({
        path: { id: this.id, table_id: column.table.id, column_id: column.id },
        body: {
          data_type: opts.dataType,
          base_version: opts.baseVersion,
          ...(opts.specificEntityType !== undefined
            ? { specific_entity_type: opts.specificEntityType }
            : {}),
        },
      })
    );
  }

  /**
   * Add a column to one of the database's tables, either creating a property
   * definition for it or binding an existing one.
   */
  async addColumn(
    table: DatabaseTable,
    opts: AddColumnOptions
  ): Promise<DatabaseColumn> {
    if (table.database.id !== this.id) {
      throw new MacroError(
        `table ${table.id} belongs to database ${table.database.id}, not ${this.id}`
      );
    }
    const binding: CreateColumnRequest['binding'] =
      'property' in opts
        ? { kind: 'existing', property_definition_id: opts.property.id }
        : {
            kind: 'new',
            name: opts.name,
            data_type: opts.dataType,
            ...(opts.multiSelect !== undefined
              ? { is_multi_select: opts.multiSelect }
              : {}),
            ...(opts.options !== undefined ? { options: opts.options } : {}),
          };
    const { columnId } = await this.mutate((c) =>
      c.storage.createDatabaseColumn({
        path: { id: this.id, table_id: table.id },
        body: {
          binding,
          ...(opts.inferType !== undefined
            ? { infer_type: opts.inferType }
            : {}),
          ...(opts.linkTo !== undefined
            ? {
                linkToTableId: opts.linkTo.id,
                linkToDatabaseId: opts.linkTo.database.id,
              }
            : {}),
        },
      })
    );
    return DatabaseColumn.byId(table, columnId);
  }

  /**
   * Add select options to one of the database's columns. Labels the column
   * already has are ignored, so the call is safe to repeat. Only select and
   * tag columns accept options.
   */
  async addColumnOptions(
    column: DatabaseColumn,
    labels: string[]
  ): Promise<ColumnDetail> {
    const table = column.table;
    if (table.database.id !== this.id) {
      throw new MacroError(
        `column ${column.id} belongs to database ${table.database.id}, not ${this.id}`
      );
    }
    return this.mutate((c) =>
      c.storage.addDatabaseColumnOptions({
        path: { id: this.id, table_id: table.id, column_id: column.id },
        body: { labels },
      })
    );
  }

  /**
   * Run read-only SQL and return the result sets of its SELECTs, in order.
   * A convenience over {@link DatabaseNamespace.query}, which also returns
   * read versions for conditional follow-up writes. Both surfaces include every
   * database the caller can reach, addressed by SQL name.
   */
  async query(sql: string): Promise<QueryResult[]> {
    const { results } = await Database.query(this.client, sql);
    return results;
  }

  /** The database as a SQLite file. */
  async downloadSqlite(): Promise<Uint8Array> {
    const bytes = unwrap(
      await this.client.storage.downloadDatabaseSqlite({
        path: { id: this.id },
        parseAs: 'arrayBuffer',
      })
    ) as unknown as ArrayBuffer;
    return new Uint8Array(bytes);
  }
}
