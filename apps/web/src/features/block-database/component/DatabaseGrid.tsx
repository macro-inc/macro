import {
  addDatabaseColumnOptions,
  applyDatabaseTableVersions,
  execSql,
} from '@queries/storage/databases';
import type { DatabaseTableDetail } from '@service-storage/databases';
import { type JSX, Show, Suspense } from 'solid-js';
import {
  type DatabaseViewConfig,
  defaultDatabaseView,
} from '../core/database-view';
import {
  DatabaseMentionPicker,
  DatabaseMentionValue,
} from '../database-mentions';
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
  return (
    <DatabaseTableView
      name={table().table.name}
      source={source}
      canEdit={props.canEdit}
      view={props.view ?? defaultDatabaseView()}
      onViewChange={props.onViewChange}
      renderMentionPicker={(picker) => <DatabaseMentionPicker {...picker} />}
      renderMentionValue={(id, entityType) => (
        <DatabaseMentionValue id={id} entityType={entityType} />
      )}
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
  );
}
