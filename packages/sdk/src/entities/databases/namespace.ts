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
 *
 * A table the user names can be a tab inside a database with another name,
 * so look through every database's tables before saying it does not exist.
 * Person columns hold user ids, never names: find people in `macro.people`,
 * then write their ids. Select the rows a write means first, then change
 * exactly those by `row_id`, and read them back before saying it worked.
 *
 * ```js
 * const databases = await macro.databases.list();
 * const matches = await Promise.all(
 *   databases.map(async (database) => ({ database, table: await database.table('Tickets') })),
 * );
 * const { database } = matches.find((match) => match.table);
 * const people = await database.query(
 *   `SELECT id FROM macro.people WHERE email = 'sam@example.com'`,
 * );
 * const sam = people.result?.rows[0]?.[0]?.value;
 * const open = await database.query(`SELECT row_id FROM "Tickets" WHERE "Status" = 'Open'`);
 * const ids = open.result?.rowHandles.map((row) => `'${row.id}'`).join(', ');
 * await database.query(`UPDATE "Tickets" SET "Owner" = '${sam}' WHERE row_id IN (${ids})`);
 * ```
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
