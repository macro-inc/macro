import { triggerFocusNewElement } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui/components/Button';
import { createSignal, type JSX, Show, splitProps } from 'solid-js';
import {
  DatabaseToolbar,
  type DatabaseToolbarProps,
} from '../database/components/database-toolbar';
import type { CreateTable } from '../database/core/table-creation';
import { MobileDatabaseToolbar } from '../database/views/mobile/database-toolbar';
import {
  NEW_TABLE_NAME_ATTRIBUTE,
  NewTableDialog,
} from '../database/views/mobile/new-table-dialog';
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
  }
) {
  const [tables, toolbar] = splitProps(props, [
    'tables',
    'activeTableId',
    'onSelectTable',
    'onCreateTable',
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
            onCreate={tables.onCreateTable}
            menuItems={tables.tableMenuItems}
          />
        }
      />
    </Show>
  );
}

/**
 * What a database without tables shows. A phone has no table tabs in its
 * header to add one from, so it offers the table here.
 */
export function DatabasePageNoTables(props: {
  onCreateTable: CreateTable | undefined;
  onOpenTable: (tableId: string) => void;
}) {
  const [creating, setCreating] = createSignal(false);

  return (
    <Show
      when={isMobile() && props.onCreateTable}
      fallback={
        <div class="grid flex-1 place-items-center p-6 text-sm text-ink-muted">
          Add a table to start organizing your data.
        </div>
      }
    >
      {(onCreateTable) => (
        <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-ink-muted">
          <p>Add a table to start organizing your data.</p>
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              // iOS raises the keyboard only for a focus inside the tap.
              triggerFocusNewElement(`[${NEW_TABLE_NAME_ATTRIBUTE}]`, {
                touchOnly: true,
              });
              setCreating(true);
            }}
          >
            <PlusIcon class="size-3.5" />
            New table
          </Button>
          <Show when={creating()}>
            <NewTableDialog
              existingNames={[]}
              onCreate={onCreateTable()}
              onOpenTable={props.onOpenTable}
              onOpenChange={setCreating}
            />
          </Show>
        </div>
      )}
    </Show>
  );
}
