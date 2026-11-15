import '@app/index.css';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { DatabaseOp } from '@core/database-sql/generated/types';
import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import type { PropertyValue } from '@service-storage/generated/schemas/propertyValue';
import type { StorageRow } from '@service-storage/generated/schemas/storageRow';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { errAsync, okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  DatabaseLinkValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../../block-database/database-mentions';
import { DatabaseEditorToolbar } from '../../database/components/database-editor-toolbar';
import { DatabaseProvider, useDatabase } from '../../database/context/database';
import type {
  DatabaseViewState,
  ViewChange,
} from '../../database/core/view-state';
import { DatabaseRecords } from '../../database/views/database-records';
import type { Pipeline } from '../core/pipeline';
import { createPipelineApi } from '../queries/pipeline-data';

function FixtureToolbar(props: {
  view: DatabaseViewState;
  onChangeView: (change: ViewChange) => void;
}) {
  const database = useDatabase();
  return (
    <DatabaseEditorToolbar
      columns={database.data.rows.columns()}
      view={props.view}
      onChangeView={props.onChangeView}
      selection={<span>Renewals</span>}
    />
  );
}

const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const pipeline: Pipeline = {
  id: id(1),
  databaseId: id(2),
  tableId: id(3),
  primaryColumnId: id(4),
  commercialFields: {
    outcome: id(9),
    money: [{ amount: id(10), currency: id(11) }],
  },
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
function selectColumn(
  columnId: string,
  name: string,
  labels: string[]
): ColumnDetail {
  const result = column(columnId, name);
  result.definition.definition.data_type = 'SELECT_STRING';
  result.column.protections = ['delete', 'change_type'];
  result.definition.property_options = labels.map((label, index) => ({
    id: `${columnId.slice(0, -4)}${columnId.slice(-2)}${String(index).padStart(2, '0')}`,
    property_definition_id: columnId,
    display_order: index,
    created_at: pipeline.createdAt,
    updated_at: pipeline.createdAt,
    color: null,
    value: { type: 'string', value: label },
  }));
  return result;
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
    columns: [
      column(id(4), 'Company', true),
      column(id(6), 'Notes'),
      selectColumn(id(9), 'Outcome', ['Open', 'Won', 'Lost']),
      (() => {
        const amount = column(id(10), 'Revenue');
        amount.definition.definition.data_type = 'NUMBER';
        return amount;
      })(),
      selectColumn(id(11), 'Revenue currency', ['USD', 'EUR', 'JPY']),
    ],
    views: [],
  };
  let rows: StorageRow[] = [
    {
      rowId: id(9),
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
        [id(6)]: {
          type: 'String',
          value:
            'Oct 21 emailed them a welcome note and a renewal quote, no reply yet',
        },
      },
    },
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
        [id(9)]: {
          type: 'SelectOption',
          value: [table.columns[2].definition.property_options[0].id],
        },
        [id(10)]: { type: 'Number', value: 1250.5 },
        [id(11)]: {
          type: 'SelectOption',
          value: [table.columns[4].definition.property_options[0].id],
        },
      },
    },
    {
      rowId: id(11),
      cells: {
        [id(6)]: { type: 'String', value: 'Line one\nLine two\nLine three' },
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
            op.change.changes.kind === 'uniform'
          ) {
            const changes = op.change.changes;
            if (
              changes.cells.some(
                (cell) =>
                  [id(4), id(9), id(11)].includes(cell.column) ||
                  cell.value.type !== 'clear'
              )
            )
              return errAsync([
                {
                  code: 'INVALID_OP' as const,
                  message: 'Cannot clear a required field',
                  refusal: null,
                },
              ]);
            rows = rows.map((row) => {
              if (!changes.rows.includes(row.rowId)) return row;
              const cells = { ...row.cells };
              for (const cell of changes.cells) delete cells[cell.column];
              return { ...row, cells };
            });
            results.push({
              kind: 'rows',
              table: pipeline.tableId,
              tableVersion: version,
              change: { kind: 'updated', affected: changes.rows.length },
            });
          } else if (
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
                          change.cells.flatMap(
                            (cell): [string, PropertyValue][] =>
                              cell.value.type === 'number'
                                ? [
                                    [
                                      cell.column,
                                      {
                                        type: 'Number',
                                        value: cell.value.value,
                                      },
                                    ],
                                  ]
                                : cell.value.type === 'text'
                                  ? [
                                      [
                                        cell.column,
                                        {
                                          type: 'String',
                                          value: cell.value.value,
                                        },
                                      ],
                                    ]
                                  : cell.value.type === 'options'
                                    ? [
                                        [
                                          cell.column,
                                          {
                                            type: 'SelectOption',
                                            value: cell.value.value.flatMap(
                                              (option) => {
                                                if ('id' in option)
                                                  return option.id
                                                    ? [option.id]
                                                    : [];
                                                const matched = table.columns
                                                  .find(
                                                    (column) =>
                                                      column.column.id ===
                                                      cell.column
                                                  )
                                                  ?.definition.property_options.find(
                                                    (candidate) =>
                                                      candidate.value.type ===
                                                        'string' &&
                                                      candidate.value.value ===
                                                        option.label
                                                  );
                                                return matched
                                                  ? [matched.id]
                                                  : [];
                                              }
                                            ),
                                          },
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
        <StaticMarkdownContext>
          <DatabaseProvider
            api={api}
            tableId={pipeline.tableId}
            view={view()}
            capabilities={{ editRows: editable(), editColumns: editable() }}
          >
            <DatabaseRecords
              view={view()}
              stored={false}
              renderToolbar={() => (
                <>
                  <div class="flex gap-4 p-2">
                    <button
                      onClick={() =>
                        setView({
                          query: { filter: null },
                          layout: {
                            kind: 'board',
                            groupBy: id(9),
                            title: id(4),
                            lanes: [],
                            cardFields: [id(9), id(10), id(11)],
                            hideEmptyLanes: false,
                          },
                        })
                      }
                    >
                      Show board
                    </button>
                  </div>
                  <FixtureToolbar
                    view={view()}
                    onChangeView={(change) =>
                      setView((current) => ({ ...current, ...change }))
                    }
                  />
                </>
              )}
              onViewChange={(change) =>
                setView((view) => ({ ...view, ...change }))
              }
              renderTextEditor={(editor) => <DatabaseTextEditor {...editor} />}
              renderTextValue={(value) => <DatabaseTextValue value={value} />}
              renderLinkValue={(url) => <DatabaseLinkValue url={url} />}
              renderMentionValue={() => <span>Acme</span>}
            />
          </DatabaseProvider>
        </StaticMarkdownContext>
      </main>
    </QueryClientProvider>
  );
}
render(Fixture, document.getElementById('root')!);
