import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  addDatabaseColumnOptions,
  applyDatabaseTableVersions,
  execSql,
  useDatabaseDetailQuery,
} from '@queries/storage/databases';
import type { DatabaseTableDetail } from '@service-storage/databases';
import { createMemo, For, type JSX, Show, Suspense } from 'solid-js';
import { DatabaseRelationCell } from '../components/database-relation-cell';
import type { DatabaseRelatedDestination } from '../core/database-relations';
import {
  type DatabaseViewConfig,
  defaultDatabaseView,
} from '../core/database-view';
import {
  DatabaseMentionPicker,
  DatabaseMentionValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../database-mentions';
import { updateDatabaseColumns } from '../queries/column-schema';
import { createDatabaseRelations } from '../queries/database-relations';
import { useRelatedDatabaseSync } from '../queries/database-relations-sync';
import { renameDatabaseColumn } from '../queries/rename-column';
import { createDatabaseRowsSource } from '../queries/table-rows';
import {
  type DatabaseTableActions,
  DatabaseTableView,
} from '../views/database-table-view';
import { AddColumnMenu } from './AddColumnMenu';

export type DatabaseGridProps = {
  databaseId: string;
  table: DatabaseTableDetail;
  canEdit: boolean;
  view?: DatabaseViewConfig;
  onViewChange?: (view: DatabaseViewConfig) => void;
  renderToolbar?: (actions: DatabaseTableActions) => JSX.Element;
  onOpenRelated?: (destination: DatabaseRelatedDestination) => void;
};

/** Production composition. A table switch owns a new query/controller lifetime. */
export function DatabaseGrid(props: DatabaseGridProps) {
  return (
    <Suspense
      fallback={<div class="p-6 text-xs text-ink-muted">Loading records…</div>}
    >
      <Show when={props.table.table.id} keyed>
        {(tableId) => <TableAdapter {...props} tableId={tableId} />}
      </Show>
    </Suspense>
  );
}

function TableAdapter(props: DatabaseGridProps & { tableId: string }) {
  // Keep the final schema for this table available to already-queued writes
  // after its tab is closed; a new selected table must never redirect them.
  let ownedTable = props.table;
  const table = () => {
    if (props.table.table.id === props.tableId) ownedTable = props.table;
    return ownedTable;
  };
  const databaseId = props.databaseId;
  const detail = useDatabaseDetailQuery(() => databaseId);
  const relatedTargets = () =>
    table().columns.flatMap((column) =>
      column.column.config?.kind === 'link' &&
      column.column.config.database_id !== databaseId
        ? [column.column.config]
        : []
    );
  const relatedDatabases = () => [
    ...new Set(relatedTargets().map((target) => target.database_id)),
  ];
  const relations = createDatabaseRelations({
    columns: () => table().columns,
    exec: execSql,
  });
  const source = createDatabaseRowsSource({
    databaseId,
    table,
    exec: execSql,
    applyVersions: (versions) =>
      applyDatabaseTableVersions(databaseId, versions),
    addOption: async (columnId, label) => {
      const updated = await addDatabaseColumnOptions({
        databaseId,
        tableId: props.tableId,
        columnId,
        labels: [label],
      });
      if (!updated) throw new Error('That option could not be added.');
    },
  });
  const rawColumns = source.columns;
  source.columns = createMemo(() =>
    rawColumns().map((column) =>
      column.relation
        ? {
            ...column,
            relation: {
              ...column.relation,
              labels: Object.fromEntries(
                relations(column.relation.tableId)
                  .rows()
                  .map((row) => [row.id, row.name])
              ),
            },
          }
        : column
    )
  );
  return (
    <>
      <For each={relatedDatabases()}>
        {(id) => {
          useRelatedDatabaseSync(id, () => [
            ...new Set(
              relatedTargets()
                .filter((target) => target.database_id === id)
                .map((target) => target.table_id)
            ),
          ]);
          return null;
        }}
      </For>
      <StaticMarkdownContext>
        <DatabaseTableView
          name={table().table.name}
          source={source}
          canEdit={props.canEdit}
          view={props.view ?? defaultDatabaseView()}
          onViewChange={props.onViewChange}
          renderTextEditor={(editor) => <DatabaseTextEditor {...editor} />}
          renderTextValue={(value) => <DatabaseTextValue value={value} />}
          renderMentionPicker={(picker) => (
            <DatabaseMentionPicker {...picker} />
          )}
          renderMentionValue={(id, entityType) => (
            <DatabaseMentionValue id={id} entityType={entityType} />
          )}
          renderRelationCell={(cell) => (
            <DatabaseRelationCell
              {...cell}
              source={relations(cell.column.relation!.tableId)}
              onOpen={(rowId) =>
                props.onOpenRelated?.({ ...cell.column.relation!, rowId })
              }
            />
          )}
          relationTables={
            detail.isSuccess
              ? detail.data.tables.map(({ table }) => ({
                  id: table.id,
                  name: table.name,
                }))
              : []
          }
          onChangeColumnType={(columnId, change) =>
            updateDatabaseColumns({
              databaseId,
              tableId: props.tableId,
              baseVersion: table().table.version,
              mutation: { kind: 'type', columnId, change },
            })
          }
          onDeleteColumn={(columnId) =>
            updateDatabaseColumns({
              databaseId,
              tableId: props.tableId,
              baseVersion: table().table.version,
              mutation: { kind: 'delete', columnId },
            })
          }
          onReorderColumns={(columnIds) =>
            updateDatabaseColumns({
              databaseId,
              tableId: props.tableId,
              baseVersion: table().table.version,
              mutation: { kind: 'order', columnIds },
            })
          }
          onRenameColumn={(columnId, name, previousName) =>
            renameDatabaseColumn({
              databaseId,
              tableId: props.tableId,
              columnId,
              name,
              previousName,
            })
          }
          renderToolbar={props.renderToolbar}
          addColumn={(label, initialType, variant, onCreated) => (
            <AddColumnMenu
              databaseId={databaseId}
              tableId={props.tableId}
              columns={table().columns}
              label={label}
              variant={variant}
              initialType={initialType}
              onCreated={onCreated}
            />
          )}
        />
      </StaticMarkdownContext>
    </>
  );
}
