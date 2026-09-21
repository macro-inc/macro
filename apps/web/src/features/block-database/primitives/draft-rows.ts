import { createSignal, createUniqueId, onCleanup } from 'solid-js';
import type { DatabaseColumnType } from '../core/column-inference';
import type { DatabaseCellValue } from '../core/database-view';
import type { DatabaseRow, DatabaseRowMutation } from '../core/table';
import type {
  AcceptedDraftWrites,
  createTableController,
} from './table-controller';

type Writer = Pick<
  ReturnType<typeof createTableController>,
  'rows' | 'runDraftWrites' | 'createResult' | 'createUncertain'
>;
type DraftRow = {
  id: string;
  started: boolean;
  cells: Record<string, DatabaseCellValue>;
  options: Record<string, string>;
  columnTypes: Record<string, DatabaseColumnType>;
  error?: string;
};

/** Local row identity survives creation, while writes still use the table's CAS queue. */
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
  const [entries, setEntries] = createSignal<DraftRow[]>([blank()]);
  const [activeId, setActiveId] = createSignal<string>();
  const requests = new Map<string, Promise<boolean>>();
  const mutations = new Map<
    string,
    Map<string, Extract<DatabaseRowMutation, { kind: 'cell' }>>
  >();
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
  function acknowledge(id: string, saved: Record<string, DatabaseCellValue>) {
    update(id, (row) => ({
      ...row,
      cells: Object.fromEntries(
        Object.entries(row.cells).filter(
          ([key, value]) => !(key in saved) || saved[key] !== value
        )
      ),
    }));
  }
  async function drain(id: string, writes: AcceptedDraftWrites) {
    update(id, (row) => ({ ...row, error: undefined }));
    try {
      while (true) {
        const current = entry(id);
        if (!current?.started) return true;
        const option = Object.entries(current.options)[0];
        if (option) {
          await writes.addGroup(option[0], option[1]);
          update(id, (row) => ({
            ...row,
            options: Object.fromEntries(
              Object.entries(row.options).filter(
                ([key, value]) => key !== option[0] || value !== option[1]
              )
            ),
          }));
          continue;
        }
        const rowId = serverId(id);
        if (!rowId) {
          const values = { ...current.cells };
          const result = await writes.save(
            {
              kind: 'create',
              values,
              ...(Object.keys(current.columnTypes).length
                ? { columnTypes: { ...current.columnTypes } }
                : {}),
            },
            'new record',
            undefined,
            id
          );
          if (!result?.insertedRowIds[0]) {
            update(id, (row) => ({
              ...row,
              error: 'Could not save this row. Your entries are kept here.',
            }));
            return false;
          }
          acknowledge(id, values);
          continue;
        }
        const field = Object.entries(current.cells)[0];
        if (!field) return true;
        let rowMutations = mutations.get(id);
        if (!rowMutations) {
          rowMutations = new Map();
          mutations.set(id, rowMutations);
        }
        const mutation = rowMutations.get(field[0]) ?? {
          kind: 'cell' as const,
          rowId,
          columnId: field[0],
          value: field[1],
        };
        mutation.value = field[1];
        if (current.columnTypes[field[0]])
          mutation.columnTypes = { [field[0]]: current.columnTypes[field[0]] };
        else delete mutation.columnTypes;
        rowMutations.set(field[0], mutation);
        const result = await writes.save(mutation, 'cell');
        if (!result) {
          update(id, (row) => ({
            ...row,
            error: 'Could not save this row. Your entries are kept here.',
          }));
          return false;
        }
        acknowledge(id, { [field[0]]: field[1] });
        rowMutations.delete(field[0]);
      }
    } catch (error) {
      update(id, (row) => ({
        ...row,
        error:
          error instanceof Error
            ? error.message
            : 'Could not save this row. Try again.',
      }));
      return false;
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
    if (starting) setEntries((rows) => [...rows, blank()]);
    return flush(id);
  }
  return {
    blankId: () => entries().find((row) => !row.started)!.id,
    setActive: (id: string | undefined) => setActiveId(id),
    has: (id: string) => !!entry(id),
    serverId,
    isUnsaved: (id: string) => !!entry(id) && !serverId(id),
    isUncertain: writer.createUncertain,
    discardUncertain: (id: string) => {
      if (!writer.createUncertain(id) || requests.has(id)) return;
      setEntries((rows) => rows.filter((row) => row.id !== id));
      mutations.delete(id);
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
      return mutation.kind === 'create'
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
      const allRows = new Map(writer.rows().map((row) => [row.rowId, row]));
      for (const local of drafts) {
        const id = serverId(local.id);
        if (!id) result.push({ rowId: local.id, cells: local.cells });
        else if (
          !visible.has(id) &&
          allRows.has(id) &&
          (activeId() === local.id ||
            Object.keys(local.cells).length > 0 ||
            local.error)
        ) {
          result.push({
            rowId: local.id,
            cells: { ...allRows.get(id)!.cells, ...local.cells },
          });
        }
      }
      return result;
    },
  };
}
