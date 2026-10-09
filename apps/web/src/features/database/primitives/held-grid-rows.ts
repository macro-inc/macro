import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { DatabaseRow } from '../core/table';

/**
 * The grid's rows. Someone else's edit can make the row being typed in stop
 * matching the view; it keeps its place until the edit ends.
 */
export function createHeldGridRows(options: {
  /** The rows the view shows, drafts included. */
  rows: Accessor<DatabaseRow[]>;
  /** Every row read so far, so a held row shows its latest values. */
  knownRows: Accessor<DatabaseRow[]>;
}) {
  const [editingRowId, setEditingRowId] = createSignal<string>();
  const rows = createMemo<DatabaseRow[]>((shownBefore) => {
    const current = options.rows();
    const held = editingRowId();
    const index = shownBefore.findIndex((row) => row.rowId === held);
    if (
      held === undefined ||
      index < 0 ||
      current.some((row) => row.rowId === held)
    )
      return current;
    return [
      ...current.slice(0, index),
      options.knownRows().find((row) => row.rowId === held) ??
        shownBefore[index],
      ...current.slice(index),
    ];
  }, []);
  return { rows, editingRowId, setEditingRowId };
}
