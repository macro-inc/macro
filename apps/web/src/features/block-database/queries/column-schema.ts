import type { OpColumnKind } from '@core/database-sql/generated/types';
import type { DatabaseColumnKind } from '../core/column-schema';

/** The op's spelling of a kind; a relation's rows live in this database. */
export function opColumnKind(
  databaseId: string,
  kind: DatabaseColumnKind
): OpColumnKind {
  return kind.type === 'relation'
    ? { type: 'relation', database: databaseId, table: kind.table }
    : kind;
}
