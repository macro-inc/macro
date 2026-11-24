import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show, splitProps } from 'solid-js';
import {
  DatabaseToolbar,
  type DatabaseToolbarProps,
} from '../database/components/database-toolbar';
import { MobileDatabaseToolbar } from '../database/views/mobile/database-toolbar';
import { TablePicker } from '../database/views/mobile/table-picker';

/** The database page's view toolbar: the desktop bar, or the touch view's two rows. */
export function DatabasePageToolbar(
  props: DatabaseToolbarProps & {
    /** The database's tables, for the touch view's table menu. */
    tables: { id: string; name: string }[];
    activeTableId: string | undefined;
    onSelectTable: (tableId: string) => void;
    /** The open table's own items in that menu, e.g. its forms. */
    tableMenuItems: (() => JSX.Element) | undefined;
  }
) {
  const [tables, toolbar] = splitProps(props, [
    'tables',
    'activeTableId',
    'onSelectTable',
    'tableMenuItems',
  ]);

  return (
    <Show when={isTouchDevice()} fallback={<DatabaseToolbar {...toolbar} />}>
      <MobileDatabaseToolbar
        {...toolbar}
        tables={
          <TablePicker
            tables={tables.tables}
            activeTableId={tables.activeTableId}
            onSelect={tables.onSelectTable}
            menuItems={tables.tableMenuItems}
          />
        }
      />
    </Show>
  );
}
