import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { z } from 'zod';
import { queryApplication } from '../group-b/command';

const UINT = z.number().int().min(0).max(0xffffffff);
const KEY = z.object({ index: UINT, generation: UINT });
const SELECTION = z.object({
  deleteExtent: z.object({
    minRow: UINT,
    maxRow: z
      .number()
      .int()
      .min(0)
      .max(2 * 0xffffffff),
    minColumn: UINT,
    maxColumn: z
      .number()
      .int()
      .min(0)
      .max(2 * 0xffffffff),
  }),
  selectedCellKeys: z.array(KEY),
});
const TABLE = z.object({
  key: KEY,
  rowCount: UINT,
  columnCount: UINT,
  rows: z.array(z.object({ key: KEY })),
  slots: z.array(z.array(KEY.nullable())),
  cells: z.array(
    z.object({
      key: KEY,
      row: UINT,
      column: UINT,
      rowSpan: UINT,
      colSpan: UINT,
      headerState: UINT,
      selectionDelete: z
        .object({ expandRows: z.boolean(), expandColumns: z.boolean() })
        .nullable(),
    })
  ),
  selection: SELECTION.nullable(),
});
const REPLY = z.object({ generation: UINT, tables: z.array(TABLE) });
export type NativeTableKey = z.infer<typeof KEY>;
export type NativeTableFacts = z.infer<typeof TABLE>;

/** Read the authoritative map; do not rebuild spans or placement from DOM/mirror data. */
export function readNativeTableFacts(
  view: EditorView,
  key: NativeTableKey
): NativeTableFacts | undefined {
  if (key.generation !== view.mirror.keyGeneration) return;
  const reply = REPLY.parse(
    queryApplication(view, 'group-b.table-facts', { keys: [key.index] })
  );
  if (
    reply.generation !== key.generation ||
    reply.generation !== view.mirror.keyGeneration
  )
    throw new Error('Table facts generation changed');
  if (reply.tables.length !== 1)
    throw new Error('Invalid table facts target count');
  const table = reply.tables[0];
  if (table.key.index !== key.index || table.key.generation !== key.generation)
    throw new Error('Table facts target mismatch');
  const refs = [
    table.key,
    ...table.rows.map((row) => row.key),
    ...table.cells.map((cell) => cell.key),
    ...(table.selection?.selectedCellKeys ?? []),
    ...table.slots.flat().filter((cell) => cell !== null),
  ];
  if (refs.some((ref) => ref.generation !== key.generation))
    throw new Error('Table facts contain a retired identity');
  return table;
}
