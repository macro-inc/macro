import type { MacroClient } from '../../utils/client';
import type { Database } from '../databases/database';
import type { DatabaseTable } from '../databases/table';
import { Form } from './form';

/** Forms collect answers into a database table without granting respondents table access. */
export class FormNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A form handle. Details load on first access. */
  byId(id: string): Form {
    return Form.byId(this.client, id);
  }

  /** Create a form over an existing table, or create its own Responses database. */
  create(options: { name: string; table?: DatabaseTable }): Promise<Form> {
    return Form.create(this.client, options);
  }

  /** List forms shared with the caller, or forms over a database the caller can read. */
  list(database?: Database): Promise<Form[]> {
    return Form.list(this.client, database);
  }
}
