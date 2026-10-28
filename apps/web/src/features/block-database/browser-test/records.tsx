import '@app/index.css';
import { okAsync, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { CellMentionEditor } from '../../../components/cell-text-editor/CellMentionEditor';
import type {
  DatabaseRowsSnapshot,
  DatabaseRowsSource,
} from '../../database/context/table-source';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { optimisticRows } from '../../database/core/table';
import { DatabaseRecordsView } from '../../database/views/database-records-view';

// A host owns the records and writes. No database entity, saved view, or app provider.
function RecordsFixture() {
  const rapid = new URLSearchParams(location.search).has('rapid');
  const holdWrites = new URLSearchParams(location.search).has('holdWrites');
  let releaseWrites!: () => void;
  const writeGate = holdWrites
    ? new Promise<void>((resolve) => {
        releaseWrites = resolve;
      })
    : Promise.resolve();
  const initialColumns: DatabaseViewColumn[] = [
    {
      id: 'name',
      name: 'Name',
      dataType: 'STRING',
      writable: true,
      isMultiSelect: false,
      options: [],
    },
  ];
  if (rapid)
    initialColumns.push(
      ...['notes', 'detail'].map((id) => ({
        ...initialColumns[0],
        id,
        name: id,
      }))
    );
  const [columns, setColumns] = createSignal(initialColumns);
  const [snapshot, setSnapshot] = createSignal<DatabaseRowsSnapshot>({
    rows: [{ rowId: 'one', cells: { name: 'First record' } }],
    retained: [],
    version: 1,
  });
  const [canEdit, setCanEdit] = createSignal(true);
  let nextRow = 0;
  const source: DatabaseRowsSource = {
    columns,
    snapshot,
    read: () => undefined,
    loading: () => false,
    refreshing: () => false,
    error: () => undefined,
    refresh: () => okAsync(undefined),
    addOption: () => okAsync(undefined),
    retain: () => {},
    write: (mutation) =>
      ResultAsync.fromSafePromise(
        holdWrites
          ? writeGate
          : rapid
            ? new Promise<void>((resolve) => setTimeout(resolve, 80))
            : Promise.resolve()
      ).andThen(() => {
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
      }),
  };
  return (
    <main class="flex h-screen flex-col bg-panel text-ink">
      <div class="flex gap-4 p-4">
        <button onClick={() => setCanEdit(false)}>Read only</button>
        {holdWrites && (
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => releaseWrites()}
          >
            Release saves
          </button>
        )}
        {rapid && (
          <button
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              setColumns((columns) =>
                columns.map((column) =>
                  column.id === 'notes'
                    ? { ...column, dataType: 'NUMBER' }
                    : column
                )
              )
            }
          >
            Infer numbers
          </button>
        )}
        <output aria-label="Stored name">
          {snapshot().rows[0]?.cells.name}
        </output>
        <output aria-label="Stored records" class="sr-only">
          {JSON.stringify(snapshot().rows)}
        </output>
      </div>
      <DatabaseRecordsView
        name="Embedded records"
        source={source}
        canEdit={canEdit()}
        renderTextEditor={
          rapid
            ? (props) => (
                <CellMentionEditor
                  {...props}
                  convertPaste={(text) => text}
                  renderMenu={() => null}
                />
              )
            : undefined
        }
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
