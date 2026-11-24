import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, Show, splitProps } from 'solid-js';
import {
  DatabaseToolbar,
  type DatabaseToolbarProps,
} from '../database/components/database-toolbar';
import type { CreateTable } from '../database/core/table-creation';
import { MobileDatabaseToolbar } from '../database/views/mobile/database-toolbar';
import { MobileNoTables } from '../database/views/mobile/no-tables';
import { TablePicker } from '../database/views/mobile/table-picker';

/** The database page's view toolbar: the desktop bar, or the touch view's two rows. */
export function DatabasePageToolbar(
  props: DatabaseToolbarProps & {
    /** The database's tables, for the touch view's table menu. */
    tables: { id: string; name: string }[];
    activeTableId: string | undefined;
    onSelectTable: (tableId: string) => void;
    /** Creates a table from that menu; omitted when the viewer cannot. */
    onCreateTable: CreateTable | undefined;
    /** The open table's own items in that menu, e.g. its forms. */
    tableMenuItems: (() => JSX.Element) | undefined;
    /** Whether that menu's button takes focus as it appears, after a switch made from it. */
    focusTableMenu: boolean;
    onTableMenuFocused: () => void;
  }
) {
  const [tables, toolbar] = splitProps(props, [
    'tables',
    'activeTableId',
    'onSelectTable',
    'onCreateTable',
    'tableMenuItems',
    'focusTableMenu',
    'onTableMenuFocused',
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
            onCreate={tables.onCreateTable}
            menuItems={tables.tableMenuItems}
            takeFocus={tables.focusTableMenu}
            onFocusTaken={tables.onTableMenuFocused}
          />
        }
      />
    </Show>
  );
}

/** What a database without tables shows. */
export function DatabasePageNoTables(props: {
  onCreateTable: CreateTable | undefined;
  onOpenTable: (tableId: string) => void;
}) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <div class="grid flex-1 place-items-center p-6 text-sm text-ink-muted">
          Add a table to start organizing your data.
        </div>
      }
    >
      <MobileNoTables
        onCreate={props.onCreateTable}
        onOpenTable={props.onOpenTable}
      />
    </Show>
  );
}
