import type { DatabaseTableDetail } from '@service-storage/databases';
import { TableNavigation } from '../components/table-navigation';
import { createTableWithName } from '../queries/create-table';
import { renameDatabaseTable } from '../queries/rename-table';

export function TableTabs(props: {
  databaseId: string;
  tables: DatabaseTableDetail[];
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
