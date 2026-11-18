import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { queryApplication } from '../../../../lib/core/component/LexicalMarkdown/plugins/group-b/command';

type CellSpan = Readonly<{ rowSpan: number; colSpan: number }>;
export interface NativeFormattingTableFacts {
  readonly selectedCellKeys: readonly number[] | null;
  readonly cells: ReadonlyMap<number, CellSpan>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUint32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffff_ffff
  );
}

function readKey(value: unknown, generation: number): number {
  if (
    !isRecord(value) ||
    value.generation !== generation ||
    !isUint32(value.index)
  )
    throw new Error('Invalid native table fact key');
  return value.index;
}

/** Read one attached table from the exact acknowledged native generation. */
export function readNativeFormattingTableFacts(
  view: EditorView,
  tableKey: number
): NativeFormattingTableFacts {
  const generation = view.mirror.keyGeneration;
  if (generation === null)
    throw new Error('Native table facts require an acknowledged generation');
  const response = queryApplication(view, 'group-b.table-facts', {
    keys: [tableKey],
  });
  if (
    !isRecord(response) ||
    response.generation !== generation ||
    view.mirror.keyGeneration !== generation ||
    !Array.isArray(response.tables) ||
    response.tables.length !== 1
  )
    throw new Error('Invalid native table facts response');
  const table: unknown = response.tables[0];
  if (
    !isRecord(table) ||
    readKey(table.key, generation) !== tableKey ||
    !Array.isArray(table.cells)
  )
    throw new Error('Invalid native table facts record');
  const cells = new Map<number, CellSpan>();
  const rawCells: readonly unknown[] = table.cells;
  for (const cell of rawCells) {
    if (
      !isRecord(cell) ||
      !isUint32(cell.rowSpan) ||
      !isUint32(cell.colSpan) ||
      cell.rowSpan === 0 ||
      cell.colSpan === 0
    )
      throw new Error('Invalid native table cell span');
    const key = readKey(cell.key, generation);
    if (cells.has(key)) throw new Error('Duplicate native table cell');
    cells.set(key, { rowSpan: cell.rowSpan, colSpan: cell.colSpan });
  }
  if (table.selection === null) return { selectedCellKeys: null, cells };
  if (
    !isRecord(table.selection) ||
    !Array.isArray(table.selection.selectedCellKeys)
  )
    throw new Error('Missing native selected-cell facts');
  const selectedCellKeys = table.selection.selectedCellKeys.map(
    (key: unknown) => readKey(key, generation)
  );
  return { selectedCellKeys, cells };
}
