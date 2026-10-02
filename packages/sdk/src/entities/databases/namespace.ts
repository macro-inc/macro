import type { DatabaseTemplate } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { type CreateDatabaseOptions, Database } from './database';

/**
 * Macro databases: named collections of tables, owned and shared as one
 * entity.
 */
export class DatabaseNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to a database by id. Details load on first access. */
  byId(id: string): Database {
    return Database.byId(this.client, id);
  }

  /** Create a database owned by the caller, blank or from a template. */
  create(options: CreateDatabaseOptions): Promise<Database> {
    return Database.create(this.client, options);
  }

  /** The templates a database can be created from, in the order a picker lists them. */
  templates(): Promise<DatabaseTemplate[]> {
    return Database.templates(this.client);
  }

  /** The databases the caller can see. */
  list(): Promise<Database[]> {
    return Database.list(this.client);
  }
}
