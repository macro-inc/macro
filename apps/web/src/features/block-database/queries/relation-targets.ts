import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { ListedDatabase } from '@service-storage/generated/schemas/listedDatabase';
import type { DatabaseRelationTargets } from '../../database/core/column-schema';

/** The tables a relation column of `open` can point at: its own, then every other live database the viewer can reach, by name. */
export function relationTargets(
  open: DatabaseDetail | undefined,
  listed: readonly ListedDatabase[]
): DatabaseRelationTargets {
  if (!open) return { here: [], elsewhere: [] };
  const databaseId = open.database.id;
  return {
    here: open.tables.map(({ table }) => ({
      databaseId,
      tableId: table.id,
      name: table.name,
    })),
    elsewhere: listed
      .filter(
        ({ database, tables }) =>
          database.id !== databaseId &&
          database.trashed_at === null &&
          tables.length > 0
      )
      .map(({ database, tables }) => ({
        databaseId: database.id,
        name: database.name,
        tables: tables.map((table) => ({
          databaseId: database.id,
          tableId: table.id,
          name: table.name,
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
