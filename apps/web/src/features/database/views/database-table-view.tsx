import {
  DatabaseTable,
  type DatabaseTableProps,
} from '../components/database-table';
import {
  createDatabaseTableModel,
  type DatabaseTableModelOptions,
} from '../primitives/table-model';

/** Own the table model for the lifetime of the grid, independently of record writes. */
export function DatabaseTableView(
  props: Omit<DatabaseTableProps, 'model' | 'resizable'> &
    DatabaseTableModelOptions
) {
  const model = createDatabaseTableModel(props);
  return (
    <DatabaseTable
      {...props}
      model={model}
      resizable={!!props.onResizeColumn}
    />
  );
}
