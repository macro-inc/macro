import { createSignal, createUniqueId, onCleanup } from 'solid-js';
import type { DatabaseColumnType } from '../core/column-inference';
import type { DatabaseCellValue } from '../core/database-view';
import type { DatabaseRow, DatabaseRowMutation } from '../core/table';
import { databaseWriteMessage } from '../core/write-failure';
import type {
  AcceptedDraftWrites,
  createTableController,
  DatabaseSaveFailure,
} from './table-controller';

function draftSaveMessage(failure: DatabaseSaveFailure): string {
  return failure.kind === 'unmounted'
    ? 'The table was closed before this row was saved.'
    : databaseWriteMessage(failure);
}

type Writer = Pick<
  ReturnType<typeof createTableController>,
  'knownRows' | 'runDraftWrites' | 'createResult' | 'createUncertain'
>;
type DraftRow = {
  id: string;
  started: boolean;
  cells: Record<string, DatabaseCellValue>;
  options: Record<string, string>;
  columnTypes: Record<string, DatabaseColumnType>;
  /** Why the row's last save did not land. */
  failure?: DatabaseSaveFailure;
  /** {@link failure} as the row's banner says it. */
  error?: string;
};

/** Local row identity survives creation, while writes still go through the table's write queue. */
export function createDraftRows(writer: Writer) {
  const prefix = createUniqueId();
  let sequence = 0;
  const blank = (): DraftRow => ({
    id: `draft:${prefix}:${++sequence}`,
    started: false,
    cells: {},
    options: {},
    columnTypes: {},
  });
  const first = blank();
  const [entries, setEntries] = createSignal<DraftRow[]>([first]);
  // The one draft not yet typed into, always last.
  const [blankId, setBlankId] = createSignal(first.id);
  const [activeId, setActiveId] = createSignal<string>();
  const requests = new Map<string, Promise<boolean>>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const entry = (id: string) => entries().find((row) => row.id === id);
  const serverId = (id: string) => writer.createResult(id)?.insertedRowIds[0];
  const update = (id: string, change: (row: DraftRow) => DraftRow) => {
    // Accepted writes still need their acknowledgment bookkeeping after unmount.
    setEntries((rows) =>
      rows.map((row) => (row.id === id ? change(row) : row))
    );
  };
  /** Saved cells, and the options their write created, are no longer pending. */
  function acknowledge(
    id: string,
    saved: Record<string, DatabaseCellValue>,
    created: Record<string, string>
  ) {
    update(id, (row) => ({
      ...row,
      cells: Object.fromEntries(
        Object.entries(row.cells).filter(
          ([key, value]) => !(key in saved) || saved[key] !== value
        )
      ),
      options: Object.fromEntries(
        Object.entries(row.options).filter(
          ([key, label]) => created[key] !== label
        )
      ),
    }));
  }
  const failed = (id: string, failure: DatabaseSaveFailure) => {
    update(id, (row) => ({
      ...row,
      failure,
      error: draftSaveMessage(failure),
    }));
    return false;
  };
  async function drain(id: string, writes: AcceptedDraftWrites) {
    update(id, (row) => ({ ...row, failure: undefined, error: undefined }));
    while (true) {
      const current = entry(id);
      if (!current?.started) return true;
      const rowId = serverId(id);
      if (!rowId) {
        const values = { ...current.cells };
        const options = { ...current.options };
        const saved = await writes.save(
          {
            kind: 'create',
            values,
            ...(Object.keys(current.columnTypes).length
              ? { columnTypes: { ...current.columnTypes } }
              : {}),
          },
          {
            label: 'new record',
            option: Object.values(options)[0],
            createIntentId: id,
          }
        );
        if (saved.isErr()) return failed(id, saved.error);
        if (!saved.value.insertedRowIds[0])
          return failed(id, { kind: 'unexpected-result' });
        acknowledge(id, values, options);
        continue;
      }
      const field = Object.entries(current.cells)[0];
      if (!field) return true;
      const [columnId, value] = field;
      const columnType = current.columnTypes[columnId];
      const option = current.options[columnId];
      const saved = await writes.save(
        {
          kind: 'cell',
          rowId,
          columnId,
          value,
          ...(columnType ? { columnTypes: { [columnId]: columnType } } : {}),
        },
        { label: 'cell', option }
      );
      if (saved.isErr()) return failed(id, saved.error);
      acknowledge(
        id,
        { [columnId]: value },
        option === undefined ? {} : { [columnId]: option }
      );
    }
  }
  async function flushAccepted(
    id: string,
    writes: AcceptedDraftWrites
  ): Promise<boolean> {
    const pending = requests.get(id);
    if (pending) {
      const saved = await pending;
      const current = entry(id);
      return saved &&
        current &&
        (Object.keys(current.cells).length > 0 ||
          Object.keys(current.options).length > 0)
        ? flushAccepted(id, writes)
        : saved;
    }
    const request = drain(id, writes).finally(() => requests.delete(id));
    requests.set(id, request);
    return request;
  }
  const flush = (id: string) =>
    writer.createUncertain(id)
      ? Promise.resolve(false)
      : writer.runDraftWrites((writes) => flushAccepted(id, writes));
  function write(
    id: string,
    columnId: string,
    value: DatabaseCellValue,
    option?: string,
    columnType?: DatabaseColumnType
  ) {
    const current = entry(id);
    if (!current || disposed) return Promise.resolve(false);
    if (!current.started && (value === null || value === ''))
      return Promise.resolve(true);
    const starting = !current.started;
    update(id, (row) => {
      const columnTypes = { ...row.columnTypes };
      if (columnType) columnTypes[columnId] = columnType;
      else delete columnTypes[columnId];
      return {
        ...row,
        started: true,
        cells: { ...row.cells, [columnId]: value },
        columnTypes,
        options:
          option === undefined
            ? row.options
            : { ...row.options, [columnId]: option },
      };
    });
    if (starting) {
      const next = blank();
      setEntries((rows) => [...rows, next]);
      setBlankId(next.id);
    }
    return flush(id);
  }
  return {
    blankId,
    setActive: (id: string | undefined) => setActiveId(id),
    has: (id: string) => !!entry(id),
    serverId,
    /**
     * The id the server knows a grid row by: a saved draft's row, any other
     * row's own id, nothing for a draft not saved yet.
     */
    savedRowId: (id: string): string | undefined =>
      entry(id) ? serverId(id) : id,
    /** Saved drafts stay on screen while being typed into, even outside the view. */
    serverIds: () =>
      entries().flatMap((row) => {
        const id = serverId(row.id);
        return id ? [id] : [];
      }),
    isUnsaved: (id: string) => !!entry(id) && !serverId(id),
    isUncertain: writer.createUncertain,
    discardUncertain: (id: string) => {
      if (!writer.createUncertain(id) || requests.has(id)) return;
      setEntries((rows) => rows.filter((row) => row.id !== id));
      if (activeId() === id) setActiveId(undefined);
    },
    write,
    error: () => entries().find((row) => row.error),
    retry: flush,
    retryTarget: (failure: {
      mutation: DatabaseRowMutation;
      createIntentId?: string;
    }) => {
      if (failure.createIntentId && entry(failure.createIntentId))
        return failure.createIntentId;
      const mutation = failure.mutation;
      return mutation.kind === 'create' || mutation.kind === 'clear'
        ? undefined
        : entries().find((row) => serverId(row.id) === mutation.rowId)?.id;
    },
    project(rows: DatabaseRow[]): DatabaseRow[] {
      const drafts = entries();
      const byServerId = new Map(
        drafts.flatMap((row) => {
          const id = serverId(row.id);
          return id ? [[id, row] as const] : [];
        })
      );
      const result = rows.map((row) => {
        const local = byServerId.get(row.rowId);
        return local
          ? { rowId: local.id, cells: { ...row.cells, ...local.cells } }
          : row;
      });
      const visible = new Set(rows.map((row) => row.rowId));
      const allRows = new Map(
        writer.knownRows().map((row) => [row.rowId, row])
      );
      for (const local of drafts) {
        const id = serverId(local.id);
        if (!id) {
          result.push({ rowId: local.id, cells: local.cells });
          continue;
        }
        const known = allRows.get(id);
        if (
          !visible.has(id) &&
          known &&
          (activeId() === local.id ||
            Object.keys(local.cells).length > 0 ||
            local.failure)
        )
          result.push({
            rowId: local.id,
            cells: { ...known.cells, ...local.cells },
          });
      }
      return result;
    },
  };
}
