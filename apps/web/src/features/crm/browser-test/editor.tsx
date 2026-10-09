import '@app/index.css';
import type { DatabaseOp } from '@core/database-sql/generated/types';
import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import type { StorageRow } from '@service-storage/generated/schemas/storageRow';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { errAsync, okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { DatabaseProvider } from '../../database/context/database';
import type { DatabaseViewState } from '../../database/core/view-state';
import { DatabaseRecords } from '../../database/views/database-records';
import type { Pipeline } from '../core/pipeline';
import { createPipelineApi } from '../queries/pipeline-data';

const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const pipeline: Pipeline = {
  id: id(1),
  databaseId: id(2),
  tableId: id(3),
  primaryColumnId: id(4),
  teamId: id(5),
  userId: 'macro|owner@example.com',
  name: 'Renewals',
  recordType: 'company',
  sharing: 'private',
  grant: 'owner',
  createdAt: '2026-10-01T00:00:00Z',
  trashedAt: null,
};
function column(columnId: string, name: string, company = false): ColumnDetail {
  return {
    sql_name: name,
    writable: true,
    shared_outside_database: false,
    column: {
      id: columnId,
      table_id: pipeline.tableId,
      property_definition_id: columnId,
      position: 'a0',
      config: null,
      display_name: null,
      infer_type: false,
      nullable: !company,
      protections: company ? ['delete', 'change_type'] : [],
    },
    definition: {
      definition: {
        id: columnId,
        display_name: name,
        data_type: company ? 'ENTITY' : 'STRING',
        specific_entity_type: company ? 'COMPANY' : null,
        is_multi_select: false,
        is_system: false,
        is_metadata: false,
        owner: { scope: 'database', database_id: pipeline.databaseId },
        created_at: pipeline.createdAt,
        updated_at: pipeline.createdAt,
      },
      property_options: [],
    },
  };
}
function Fixture() {
  const [editable, setEditable] = createSignal(true);
  const [writes, setWrites] = createSignal(0);
  const [view, setView] = createSignal<DatabaseViewState>({
    query: { filter: null },
    layout: { kind: 'table', columns: [] },
  });
  let table: TableDetail = {
    table: {
      id: pipeline.tableId,
      database_id: pipeline.databaseId,
      name: 'Records',
      position: 'a0',
      version: 1,
    },
    sql_name: 'Records',
    columns: [column(id(4), 'Company', true), column(id(6), 'Notes')],
    views: [],
  };
  let rows: StorageRow[] = [
    {
      rowId: id(7),
      cells: {
        [id(4)]: {
          type: 'EntityReference',
          value: [
            {
              entity_id: id(8),
              entity_type: 'COMPANY',
              specific_message_id: null,
            },
          ],
        },
        [id(6)]: { type: 'String', value: 'Follow up' },
      },
    },
  ];
  const api = createPipelineApi(
    {
      getCrmPipelineTable: async () => okAsync(table),
      queryCrmPipelineRows: async () =>
        okAsync({ rows, version: table.table.version, next: null }),
      applyCrmPipelineOps: (
        _pipelineId: string,
        batch: { ops: DatabaseOp[] }
      ) => {
        const version = table.table.version + 1;
        const results: OpResult[] = [];
        for (const op of batch.ops) {
          if (
            op.kind === 'rows' &&
            op.change.kind === 'update' &&
            op.change.changes.kind === 'per_row'
          ) {
            for (const change of op.change.changes.rows)
              rows = rows.map((row) =>
                row.rowId !== change.row
                  ? row
                  : {
                      ...row,
                      cells: {
                        ...row.cells,
                        ...Object.fromEntries(
                          change.cells.flatMap((cell) =>
                            cell.value.type === 'text'
                              ? [
                                  [
                                    cell.column,
                                    { type: 'String', value: cell.value.value },
                                  ],
                                ]
                              : []
                          )
                        ),
                      },
                    }
              );
            results.push({
              kind: 'rows',
              table: pipeline.tableId,
              tableVersion: version,
              change: { kind: 'updated', affected: 1 },
            });
          } else if (
            op.kind === 'column' &&
            op.change.kind === 'create' &&
            op.change.definition.source === 'new'
          ) {
            table = {
              ...table,
              columns: [
                ...table.columns,
                column(op.column, op.change.definition.name),
              ],
            };
            results.push({
              kind: 'column',
              table: pipeline.tableId,
              tableVersion: version,
              column: op.column,
              change: { kind: 'created' },
            });
          } else
            return errAsync([
              {
                code: 'INVALID_OP' as const,
                message: 'Unsupported fixture operation',
                refusal: null,
              },
            ]);
        }
        table = { ...table, table: { ...table.table, version } };
        setWrites((value) => value + 1);
        return okAsync({ results, changes: [] });
      },
    },
    pipeline
  );
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <main class="flex h-screen flex-col bg-panel text-ink">
        <button onClick={() => setEditable((value) => !value)}>
          Toggle editing
        </button>
        <output aria-label="Pipeline writes">{writes()}</output>
        <DatabaseProvider
          api={api}
          tableId={pipeline.tableId}
          view={view()}
          capabilities={{ editRows: editable(), editColumns: editable() }}
        >
          <DatabaseRecords
            view={view()}
            stored={false}
            onViewChange={(change) =>
              setView((view) => ({ ...view, ...change }))
            }
            renderMentionValue={() => <span>Acme</span>}
          />
        </DatabaseProvider>
      </main>
    </QueryClientProvider>
  );
}
render(Fixture, document.getElementById('root')!);
