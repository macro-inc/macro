import type { ExecOutcome } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { Database, type ExecOptions } from './database';

/**
 * Macro databases: named collections of tables, owned and shared as one
 * entity, and queryable with SQL.
 */
export class DatabaseNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a database by id. Details load on first access. */
  byId(id: string): Database {
    return Database.byId(this.client, id);
  }

  /** Create a database owned by the caller. */
  create(opts: { name: string }): Promise<Database> {
    return Database.create(this.client, opts);
  }

  /** The databases the caller can see. */
  list(): Promise<Database[]> {
    return Database.list(this.client);
  }

  /**
   * Run SQL, in one transaction, over every database the caller can reach —
   * tables are addressed by their SQL names ({@link DatabaseTable.sqlName}),
   * so a statement may read and write across databases.
   *
   * The outcome carries the SELECT result sets, what the writes changed, the
   * ids of inserted rows, and the versions to send back as
   * {@link ExecOptions.baseVersions} for a compare-and-set follow-up.
   */
  exec(opts: ExecOptions): Promise<ExecOutcome> {
    return Database.exec(this.client, opts);
  }

  /** Read-only SQL with actual read versions for a conditional follow-up write. */
  query(sql: string): Promise<ExecOutcome> {
    return Database.query(this.client, sql);
  }
}
