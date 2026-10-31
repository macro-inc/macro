import type { MacroClient } from '../../utils/client';
import { Database } from './database';
import {
  type DatabaseQueryOptions,
  type DatabaseQueryResult,
  queryDatabases,
} from './query';

/**
 * Macro databases: named collections of tables, owned and shared as one
 * entity.
 */
export class DatabaseNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Run one SQL statement over the caller's visible databases. Writes execute once. */
  query(
    sql: string,
    options?: DatabaseQueryOptions,
  ): Promise<DatabaseQueryResult> {
    return queryDatabases(this.client, Database.byId, sql, options);
  }

  /** A handle to a database by id. Details load on first access. */
  byId(id: string): Database {
    return Database.byId(this.client, id);
  }

  /** Create a database owned by the caller. */
  create(options: { name: string }): Promise<Database> {
    return Database.create(this.client, options);
  }

  /** The databases the caller can see. */
  list(): Promise<Database[]> {
    return Database.list(this.client);
  }
}
