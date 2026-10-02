import { toast } from '@core/component/Toast/Toast';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { TableNavigation } from '../components/table-navigation';
import { tableDeleteMessage, tableOrderMessage } from '../core/column-schema';
import { createTableWithName } from '../queries/create-table';
import { deleteDatabaseTable } from '../queries/delete-table';
import { renameDatabaseTable } from '../queries/rename-table';
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
        renameDatabaseTable({
          databaseId: props.databaseId,
          tableId,
          name,
          previousName,
        })
      }
      onReorder={(tableIds) =>
        void reorderDatabaseTables({
          databaseId: props.databaseId,
          tableIds,
        }).mapErr((errors) => toast.failure(tableOrderMessage(errors)))
      }
      onDelete={(tableId) =>
        void deleteDatabaseTable({
          databaseId: props.databaseId,
          tableId,
        }).mapErr((error) => toast.failure(tableDeleteMessage(error)))
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
