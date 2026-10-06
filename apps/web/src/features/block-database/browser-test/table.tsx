import '@app/index.css';
import type { SortKey } from '@core/database-sql/generated/types';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { GridCell } from '../component/GridCell';
import type { DatabaseViewColumn } from '../core/database-view';
import { moveBeside } from '../core/move-beside';
import type { DatabaseRow } from '../core/table';
import { withSort } from '../core/view-query';
import { DatabaseTableView } from '../views/database-table-view';

// Real grid and editors; records and saved layout are local to this browser fixture.
function TableFixture() {
  const [columns, setColumns] = createSignal<DatabaseViewColumn[]>([
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
    {
      id: 'status',
      name: 'Status',
      dataType: 'SELECT_STRING',
      writable: true,
      isMultiSelect: false,
      options: [
        { id: 'open', label: 'Open', color: null },
        { id: 'done', label: 'Done', color: null },
      ],
    },
    {
      id: 'amount',
      name: 'Amount',
      dataType: 'NUMBER',
      writable: true,
      isMultiSelect: false,
      options: [],
    },
  ]);
  const [rows, setRows] = createSignal<DatabaseRow[]>([
    {
      rowId: 'one',
      cells: { name: 'First', notes: 'First note', status: 'Open', amount: 12 },
    },
    {
      rowId: 'two',
      cells: {
        name: 'Second',
        notes: 'Second note',
        status: 'Done',
        amount: 24,
      },
    },
  ]);
  const [order, setOrder] = createSignal(['name', 'notes', 'status', 'amount']);
  const [widths, setWidths] = createSignal<Record<string, number | null>>({});
  const [sort, setSort] = createSignal<SortKey[]>([]);
  const [resizeSaves, setResizeSaves] = createSignal(0);
  const [writes, setWrites] = createSignal(0);
  return (
    <main class="flex h-screen flex-col bg-panel text-ink">
      <div class="flex gap-4 p-4">
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setColumns((before) => before.map((column) => ({ ...column })));
            setRows((before) =>
              before.map((row) => ({
                ...row,
                cells: { ...row.cells, notes: 'Remote update' },
              }))
            );
          }}
        >
          Remote update
        </button>
        <button
          onClick={() => {
            setOrder(['status', 'notes', 'name']);
            setWidths({ name: 240, notes: 220, status: 180 });
          }}
        >
          Switch view
        </button>
        <output aria-label="Resize saves">{resizeSaves()}</output>
        <output aria-label="Writes">{writes()}</output>
        <output aria-label="Sort">{JSON.stringify(sort())}</output>
      </div>
      <DatabaseTableView
        name="Tasks"
        rows={rows()}
        columns={columns()}
        columnOrder={order()}
        widths={widths()}
        sort={sort()}
        titleColumnId="name"
        canEdit
        pending={false}
        addColumn={<button>Add column</button>}
        onOpen={() => {}}
        getRowTitle={(row) => String(row.cells.name)}
        onSort={(id, direction) =>
          setSort((before) =>
            withSort(
              before,
              id,
              direction === null
                ? null
                : direction === 'asc'
                  ? 'ascending'
                  : 'descending'
            )
          )
        }
        onResizeColumn={(id, width) => {
          setWidths((before) => ({ ...before, [id]: width }));
          setResizeSaves((count) => count + 1);
        }}
        onReorderColumn={async (id, target, edge) => {
          setOrder((before) => moveBeside(before, id, target, edge) ?? before);
        }}
        renderCell={(row, column, options) => (
          <GridCell
            column={column()}
            value={row().cells[column().id] ?? null}
            canEdit
            onAddOption={async () => true}
            onWrite={async (value) => {
              const rowId = row().rowId;
              const columnId = column().id;
              setWrites((count) => count + 1);
              setRows((before) =>
                before.map((entry) =>
                  entry.rowId === rowId
                    ? { ...entry, cells: { ...entry.cells, [columnId]: value } }
                    : entry
                )
              );
              return true;
            }}
            {...options}
          />
        )}
      />
    </main>
  );
}
render(() => <TableFixture />, document.getElementById('root')!);
