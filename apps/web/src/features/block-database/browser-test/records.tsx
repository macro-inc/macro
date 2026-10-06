import '@app/index.css';
import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type {
  DatabaseRowsSnapshot,
  DatabaseRowsSource,
} from '../context/table-source';
import type { DatabaseViewColumn } from '../core/database-view';
import { optimisticRows } from '../core/table';
import { DatabaseRecordsView } from '../views/database-records-view';

// A host owns the records and writes. No database entity, saved view, or app provider.
function RecordsFixture() {
  const columns: DatabaseViewColumn[] = [
    {
      id: 'name',
      name: 'Name',
      dataType: 'STRING',
      writable: true,
      isMultiSelect: false,
      options: [],
    },
  ];
  const [snapshot, setSnapshot] = createSignal<DatabaseRowsSnapshot>({
    rows: [{ rowId: 'one', cells: { name: 'First record' } }],
    retained: [],
    version: 1,
  });
  const [canEdit, setCanEdit] = createSignal(true);
  let nextRow = 0;
  const source: DatabaseRowsSource = {
    columns: () => columns,
    snapshot,
    read: () => undefined,
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: () => okAsync(undefined),
    addOption: () => okAsync(undefined),
    retain: () => {},
    write: (mutation) => {
      const current = snapshot();
      const version = (current.version ?? 0) + 1;
      const insertedRowIds =
        mutation.kind === 'create' ? [`created-${++nextRow}`] : [];
      const rows =
        mutation.kind === 'create'
          ? [
              ...current.rows,
              { rowId: insertedRowIds[0], cells: mutation.values },
            ]
          : optimisticRows(current.rows, [mutation]);
      setSnapshot({ rows, retained: [], version });
      return okAsync({ version, insertedRowIds });
    },
  };
  return (
    <main class="flex h-screen flex-col bg-panel text-ink">
      <div class="flex gap-4 p-4">
        <button onClick={() => setCanEdit(false)}>Read only</button>
        <output aria-label="Stored name">
          {snapshot().rows[0]?.cells.name}
        </output>
      </div>
      <DatabaseRecordsView
        name="Embedded records"
        source={source}
        canEdit={canEdit()}
        view={{
          query: { filter: null },
          layout: { kind: 'table', columns: [] },
        }}
        stored={false}
        boardPositions={{
          state: () => ({ kind: 'ready', positions: [] }),
          setPositions: () => {},
          move: () => okAsync({ positions: [], tableVersion: 1 }),
        }}
      />
    </main>
  );
}

render(() => <RecordsFixture />, document.getElementById('root')!);
