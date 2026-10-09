import '@app/index.css';
import type { OpResult } from '@core/database-sql/generated/types';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { errAsync, okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { DatabaseProvider } from '../../database/context/database';
import type { DatabaseApi, DatabaseTableSchema } from '../../database/core/api';
import type { DatabaseRow } from '../../database/core/table';
import type { DatabaseViewState } from '../../database/core/view-state';
import { DatabaseRecords } from '../../database/views/database-records';

const tableId = '00000000-0000-0000-0000-000000000001';
const nameId = '00000000-0000-0000-0000-000000000002';
const statusId = '00000000-0000-0000-0000-000000000003';
const optionId = '00000000-0000-0000-0000-000000000004';

function ApiFixture() {
  const [editable, setEditable] = createSignal(true);
  const [writes, setWrites] = createSignal(0);
  const [view, setView] = createSignal<DatabaseViewState>({
    query: { filter: null },
    layout: { kind: 'table', columns: [] },
  });
  let table: DatabaseTableSchema = {
    id: tableId,
    databaseId: tableId,
    name: 'API records',
    version: 1,
    columns: [
      {
        id: nameId,
        name: 'Name',
        dataType: 'STRING',
        isMultiSelect: false,
        writable: true,
        options: [],
      },
      {
        id: statusId,
        name: 'Status',
        dataType: 'SELECT_STRING',
        isMultiSelect: false,
        writable: true,
        options: [{ id: optionId, label: 'Open', color: null }],
      },
    ],
  };
  let rows: DatabaseRow[] = ['First', 'Second'].map((name, index) => ({
    rowId: `00000000-0000-0000-0000-00000000001${index}`,
    cells: { [nameId]: name, [statusId]: 'Open' },
  }));
  const api: DatabaseApi = {
    key: ['standalone-api-fixture'],
    readTable: () => okAsync(table),
    readRows: ({ cursor, rowIds }) => {
      const selected = rowIds
        ? rows.filter((row) => rowIds.includes(row.rowId))
        : rows;
      const offset = Number(cursor ?? 0);
      return okAsync({
        rows: selected.slice(offset, offset + 1),
        nextCursor:
          offset + 1 < selected.length ? String(offset + 1) : undefined,
        tableVersion: table.version,
      });
    },
    applyOps: ({ ops }) => {
      const results: OpResult[] = [];
      const version = table.version + 1;
      for (const op of ops) {
        if (
          op.kind === 'column' &&
          op.change.kind === 'create' &&
          op.change.definition.source === 'new'
        ) {
          table = {
            ...table,
            version,
            columns: [
              ...table.columns,
              {
                id: op.column,
                name: op.change.definition.name,
                dataType: 'STRING',
                writable: true,
                isMultiSelect: false,
                options: [],
              },
            ],
          };
          results.push({
            kind: 'column',
            table: tableId,
            column: op.column,
            tableVersion: version,
            change: { kind: 'created' },
          });
        } else if (op.kind === 'column' && op.change.kind === 'rename') {
          const name = op.change.name;
          table = {
            ...table,
            version,
            columns: table.columns.map((column) =>
              column.id === op.column ? { ...column, name } : column
            ),
          };
          results.push({
            kind: 'column',
            table: tableId,
            column: op.column,
            tableVersion: version,
            change: { kind: 'renamed' },
          });
        } else if (
          op.kind === 'rows' &&
          op.change.kind === 'update' &&
          op.change.changes.kind === 'per_row'
        ) {
          for (const change of op.change.changes.rows)
            rows = rows.map((row) =>
              row.rowId === change.row
                ? {
                    ...row,
                    cells: {
                      ...row.cells,
                      ...Object.fromEntries(
                        change.cells.map((cell) => [
                          cell.column,
                          cell.value.type === 'text' ? cell.value.value : null,
                        ])
                      ),
                    },
                  }
                : row
            );
          table = { ...table, version };
          results.push({
            kind: 'rows',
            table: tableId,
            tableVersion: version,
            change: {
              kind: 'updated',
              affected: op.change.changes.rows.length,
            },
          });
        } else
          return errAsync({
            code: 'INVALID_OP',
            refusal: null,
            message: 'Unsupported fixture operation',
          });
      }
      setWrites((count) => count + 1);
      return okAsync({ results });
    },
  };
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <main class="flex h-screen flex-col bg-panel text-ink">
        <div class="flex gap-4 p-4">
          <button onClick={() => setEditable((value) => !value)}>
            Toggle editing
          </button>
          <button
            onClick={() =>
              setView({
                query: { filter: null },
                layout: {
                  kind: 'board',
                  groupBy: statusId,
                  title: nameId,
                  lanes: [],
                  cardFields: [],
                  hideEmptyLanes: false,
                },
              })
            }
          >
            Show board
          </button>
          <output aria-label="API writes">{writes()}</output>
        </div>
        <DatabaseProvider
          api={api}
          tableId={tableId}
          view={view()}
          capabilities={{ editRows: editable(), editColumns: editable() }}
        >
          <DatabaseRecords
            view={view()}
            stored={false}
            onViewChange={(change) =>
              setView((view) => ({ ...view, ...change }))
            }
          />
        </DatabaseProvider>
      </main>
    </QueryClientProvider>
  );
}
render(ApiFixture, document.getElementById('root')!);
