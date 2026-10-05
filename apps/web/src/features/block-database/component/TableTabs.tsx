import { toast } from '@core/component/Toast/Toast';
import { applyDatabaseOps } from '@queries/storage/databases';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { ResultAsync } from 'neverthrow';
import { TableNavigation } from '../components/table-navigation';
import { tableDeleteMessage, tableOrderMessage } from '../core/column-schema';
import { createTableWithName } from '../queries/create-table';
import { patchDetail, patchTable } from '../queries/detail-cache';
import { reorderDatabaseTables } from '../queries/reorder-tables';

export function TableTabs(props: {
  databaseId: string;
  tables: TableDetail[];
  activeTableId: string | undefined;
  canEdit: boolean;
  onSelect: (tableId: string) => void;
}) {
  return (
    <TableNavigation
      tables={props.tables.map((table) => ({
        id: table.table.id,
        name: table.table.name,
      }))}
      activeTableId={props.activeTableId}
      canCreate={props.canEdit}
      onSelect={props.onSelect}
      onRename={(tableId, name, previousName) =>
        ResultAsync.fromSafePromise(
          patchTable(props.databaseId, tableId, (entry) => ({
            ...entry,
            table: { ...entry.table, name },
          }))
        )
          .andThen((rollback) =>
            applyDatabaseOps(props.databaseId, [
              {
                kind: 'table',
                table: tableId,
                change: { kind: 'rename', name, previousName },
              },
            ]).mapErr((error) => {
              rollback();
              return error;
            })
          )
          .map(() => undefined)
      }
      onReorder={(tableIds) =>
        void reorderDatabaseTables({
          databaseId: props.databaseId,
          tableIds,
        }).mapErr((errors) => toast.failure(tableOrderMessage(errors)))
      }
      onDelete={(tableId) =>
        void ResultAsync.fromSafePromise(
          patchDetail(props.databaseId, (detail) => ({
            ...detail,
            tables: detail.tables.filter((entry) => entry.table.id !== tableId),
          }))
        )
          .andThen((rollback) =>
            applyDatabaseOps(props.databaseId, [
              { kind: 'table', table: tableId, change: { kind: 'delete' } },
            ]).mapErr((error) => {
              rollback();
              return error;
            })
          )
          .mapErr((error) => toast.failure(tableDeleteMessage(error)))
      }
      onCreate={(name, existingTableId) =>
        createTableWithName({
          databaseId: props.databaseId,
          name,
          existingTableId,
        })
      }
    />
  );
}
