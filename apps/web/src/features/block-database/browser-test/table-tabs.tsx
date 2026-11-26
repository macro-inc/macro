import '@app/index.css';
import { useViewTabHotkeys } from '@app/components/view-shell';
import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { GridCell } from '../../database/components/grid-cell';
import { TableNavigation } from '../../database/components/table-navigation';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import type { DatabaseRow } from '../../database/core/table';
import { DatabaseTableView } from '../../database/views/database-table-view';

const TABLES = [
  { id: 'tasks', name: 'Tasks' },
  { id: 'people', name: 'People' },
];

const COLUMNS: DatabaseViewColumn[] = [
  {
    id: 'name',
    name: 'Name',
    dataType: 'STRING',
    writable: true,
    isMultiSelect: false,
    options: [],
  },
  {
    id: 'notes',
    name: 'Notes',
    dataType: 'STRING',
    writable: true,
    isMultiSelect: false,
    options: [],
  },
];

const ROWS: DatabaseRow[] = [
  { rowId: 'one', cells: { name: 'First', notes: 'First note' } },
  { rowId: 'two', cells: { name: 'Second', notes: 'Second note' } },
];

/**
 * A database in a split, over the real hotkey engine: the real table tabs
 * bound to Tab and the number keys as `TableTabs` binds them, above the real
 * records grid and cell editors. Records are local.
 */
function TableTabsFixture() {
  useHotKeyRoot();
  const [attachSplit, scopeId] = useHotkeyDOMScope('database-split');
  const [active, setActive] = createSignal('tasks');
  const [tabs, setTabs] = createSignal<HTMLElement>();

  useViewTabHotkeys({
    scopeId,
    tabs,
    ids: () => TABLES.map((table) => table.id),
    activeId: active,
    setActiveId: setActive,
    label: (id) => TABLES.find((table) => table.id === id)?.name ?? id,
  });

  return (
    <div ref={(element) => attachGlobalDOMScope(element)}>
      <main
        ref={attachSplit}
        tabIndex={-1}
        data-view-shell-main=""
        class="flex h-screen flex-col bg-panel text-ink"
      >
        <div class="flex items-center gap-4 p-4">
          <TableNavigation
            tabsRef={setTabs}
            tables={TABLES}
            activeTableId={active()}
            canCreate={false}
            onSelect={setActive}
            onCreate={() => {
              throw new Error('This fixture creates no tables.');
            }}
          />
          <output aria-label="Table">{active()}</output>
        </div>
        <DatabaseTableView
          name="Tasks"
          rows={ROWS}
          columns={COLUMNS}
          columnOrder={COLUMNS.map((column) => column.id)}
          widths={{}}
          sort={[]}
          titleColumnId="name"
          canEdit
          pending={false}
          onOpen={() => {}}
          getRowTitle={(row) => String(row.cells.name)}
          onSort={() => {}}
          onResizeColumn={() => {}}
          onReorderColumn={async () => {}}
          renderCell={(row, column, options) => (
            <GridCell
              column={column()}
              value={row().cells[column().id] ?? null}
              canEdit
              onAddOption={async () => true}
              onWrite={async () => true}
              {...options}
            />
          )}
        />
      </main>
    </div>
  );
}

render(() => <TableTabsFixture />, document.getElementById('root')!);
