import { createDatabaseRelations } from '@app/features/block-database/queries/database-relations';
import { idToDisplayName } from '@core/user/util';
import { useDatabasesQuery } from '@queries/storage/databases';
import { useDatabaseTableChanges } from '@queries/storage/databases-sync';
import { match } from 'ts-pattern';
import type { AnswerDisplay } from '../context/answer-display';

/**
 * People are named from the contacts the engine reads them from; related
 * rows by their table's title, from one live read per related table, found
 * among the databases the viewer can reach.
 */
export const answerNames: AnswerDisplay['names'] = (answer) => {
  const listed = useDatabasesQuery();
  const relations = createDatabaseRelations({
    targets: () => {
      const related = new Set(
        (answer()?.columns ?? []).flatMap((column) =>
          column.source?.relatedTable ? [column.source.relatedTable] : []
        )
      );
      if (!related.size || !listed.isSuccess) return [];
      return listed.data.flatMap((entry) =>
        entry.tables.flatMap((table) =>
          related.has(table.id)
            ? [{ databaseId: table.database_id, tableId: table.id }]
            : []
        )
      );
    },
    onTableChanged: (listener) =>
      useDatabaseTableChanges((change) => listener(change.tableId)),
  });
  return () =>
    ({ kind, id, table }) =>
      match(kind)
        .with('USER', () => idToDisplayName(id) || undefined)
        .with('DATABASE_ROW', () =>
          table
            ? relations(table)
                .rows()
                .find((row) => row.id === id)?.name
            : undefined
        )
        .otherwise(() => undefined);
};
