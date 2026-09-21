import type { Accessor } from 'solid-js';
import type { DatabaseRelatedRow } from '../core/database-relations';

export type DatabaseRelationSource = {
  name: Accessor<string>;
  rows: Accessor<DatabaseRelatedRow[]>;
  loading: Accessor<boolean>;
  error: Accessor<string | undefined>;
  refresh: () => Promise<void>;
};
