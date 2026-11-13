import { match } from 'ts-pattern';
import type {
  DatabaseSyncDetachReason,
  DatabaseSyncField,
  DatabaseSync as DatabaseSyncRecord,
  DatabaseSyncSource as DatabaseSyncSourceRecord,
  DatabaseSyncStatus,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { User } from '../users/user';
import { DatabaseColumn } from './column';
import type { Database } from './database';
import { DatabaseTable } from './table';

/**
 * A Notion data source (one table of a Notion database) that the caller's
 * Notion connection can read. Get one from
 * `macro.databases.syncSources()`.
 */
export class NotionDataSource {
  private constructor(
    /** Notion's identifier of the data source. */
    readonly id: string,
    /** Its title in Notion; unknown on a sync's own source. */
    readonly title: string | undefined,
  ) {}

  /** @internal A handle from what an API answered. */
  static of(id: string, title: string | undefined): NotionDataSource {
    return new NotionDataSource(id, title);
  }

  /** This data source as plain JSON. */
  toJSON(): { id: string; title: string | undefined } {
    return { id: this.id, title: this.title };
  }
}

/**
 * What a synced table mirrors: the caller's Granola meetings, or a Notion
 * data source their Notion connection can read.
 */
export type DatabaseSyncSource =
  | { kind: 'granola_meetings' }
  | { kind: 'notion_data_source'; dataSource: NotionDataSource };

/** What the caller can sync a table from. */
export type DatabaseSyncSources = {
  /** Whether a Granola connection syncs the caller's meetings into Macro. */
  granola: { connected: boolean };
  /**
   * Whether Notion is connected, and the data sources it can read, most
   * recently edited first; empty when not connected.
   */
  notion: { connected: boolean; dataSources: NotionDataSource[] };
};

/** A column a sync writes, and the source field it holds. */
export type DatabaseSyncColumn = {
  column: DatabaseColumn;
  field: DatabaseSyncField;
};

/** A column a sync stopped writing; its cells stay and the field never comes back. */
export type DatabaseSyncDetachedColumn = DatabaseSyncColumn & {
  reason: DatabaseSyncDetachReason;
};

/** @internal The wire form of a source. */
export function sourceRecord(
  source: DatabaseSyncSource,
): DatabaseSyncSourceRecord {
  return match(source)
    .with({ kind: 'granola_meetings' }, () => ({
      kind: 'granola_meetings' as const,
    }))
    .with({ kind: 'notion_data_source' }, ({ dataSource }) => ({
      kind: 'notion_data_source' as const,
      dataSourceId: dataSource.id,
    }))
    .exhaustive();
}

function sourceOf(record: DatabaseSyncSourceRecord): DatabaseSyncSource {
  return match(record)
    .with({ kind: 'granola_meetings' }, () => ({
      kind: 'granola_meetings' as const,
    }))
    .with({ kind: 'notion_data_source' }, ({ dataSourceId }) => ({
      kind: 'notion_data_source' as const,
      dataSource: NotionDataSource.of(dataSourceId, undefined),
    }))
    .exhaustive();
}

/**
 * A table of a {@link Database} kept in sync with an outside source. A
 * worker upserts the source's records into it as rows, acting with the
 * access of the user who created the sync: Granola meetings every 15
 * minutes and on each import, Notion every 30 minutes. Rows mirror the
 * source, so a row deleted in Macro comes back on the next run.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class DatabaseSync {
  private constructor(
    private readonly client: MacroClient,
    /** The table the sync writes. */
    readonly table: DatabaseTable,
    /** Identifier of the sync. */
    readonly id: string,
    /** Who created it; its writes act with their access. */
    readonly createdBy: User,
    /** What it mirrors. */
    readonly source: DatabaseSyncSource,
    private readonly record: DatabaseSyncRecord,
  ) {}

  /** @internal A handle from the record the API answered. */
  static fromRecord(
    client: MacroClient,
    database: Database,
    record: DatabaseSyncRecord,
  ): DatabaseSync {
    return new DatabaseSync(
      client,
      DatabaseTable.byId(database, record.tableId),
      record.id,
      User.byId(client, record.createdBy),
      sourceOf(record.source),
      record,
    );
  }

  /** The database whose table it writes. */
  get database(): Database {
    return this.table.database;
  }

  /** How its last run went: `pending`, `synced`, or `failed` with a reason. */
  get status(): DatabaseSyncStatus {
    return this.record.status;
  }

  /** When a run last succeeded, if one has. */
  get lastSyncedAt(): string | undefined {
    return this.record.lastSyncedAt ?? undefined;
  }

  /** When it was created. */
  get createdAt(): string {
    return this.record.createdAt;
  }

  /** The columns it writes, each with the source field it holds. */
  get columns(): DatabaseSyncColumn[] {
    return this.record.columns.map(({ column, field }) => ({
      column: DatabaseColumn.byId(this.table, column),
      field,
    }));
  }

  /** The columns it stopped writing because someone deleted or retyped them. */
  get detachedColumns(): DatabaseSyncDetachedColumn[] {
    return this.record.detachedColumns.map(({ column, field, reason }) => ({
      column: DatabaseColumn.byId(this.table, column),
      field,
      reason,
    }));
  }

  /**
   * Run the sync as soon as a worker is free. Returns once it is queued, not
   * when it finishes; read {@link Database.syncs} later for its status.
   *
   * @write
   * @openworld
   */
  async syncNow(): Promise<void> {
    unwrap(
      await this.client.cognition.runDatabaseSync({
        path: { id: this.database.id, sync_id: this.id },
      }),
    );
  }

  /**
   * Stop syncing. The table and its rows stay as they are.
   *
   * @destructive
   */
  async stop(): Promise<void> {
    unwrap(
      await this.client.cognition.deleteDatabaseSync({
        path: { id: this.database.id, sync_id: this.id },
      }),
    );
  }

  /** This sync as plain JSON. */
  toJSON() {
    return {
      id: this.id,
      databaseId: this.database.id,
      tableId: this.table.id,
      source: this.source,
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
    };
  }
}
