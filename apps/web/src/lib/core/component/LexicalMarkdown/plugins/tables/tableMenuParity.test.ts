/** @vitest-environment jsdom */
/**
 * Touch handle menu parity, Source against native. Both engines load the same
 * serialized state. The Source side is a literal copy of TableMoveHandle
 * runMenuAction (live Range/Table anchor cell, else tracked.selectStart(), then
 * the item's Lexical call) in one update; native runs the move host and awaits
 * its settlement. Compared after the action and after one undo: the whole
 * root JSON (spans, header state, widths, every node; only `$` id metadata is
 * stripped) and the full selection (both endpoints as root paths with type and
 * offset, format and style; none and an outside range kept distinct).
 *
 * History here is fixture history only: @lexical/history on Source against the
 * native session's own undo. It is not app Loro history acceptance, which
 * stays with the table-hover-browser-test history epoch.
 */
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  $createTableSelection,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
  $unmergeCell,
  type TableCellNode,
} from '@lexical/table';
import { CommandCode } from '@macro-inc/collaboration/session/abi.generated';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
  UNDO_COMMAND,
} from 'lexical';
import { match } from 'ts-pattern';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { createNativeTableMoveHost } from '../../editing/overlay-hosts/native-table-move';
import type { TableMoveMenuAction } from '../../editing/overlay-hosts/table-move';
import { createTableTestEditor } from './tableTestUtils';

beforeAll(initializeNativeSurfaceTests);
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

type Coordinate = [row: number, column: number];
/** One cell: its text and spans. */
type CellSpec = { text: string; colSpan?: number; rowSpan?: number };
type Live =
  | { kind: 'table'; anchor: Coordinate; focus: Coordinate }
  | { kind: 'caret'; cell: Coordinate }
  | { kind: 'outside' };
/** A point as child indices from the root to its node, plus type and offset. */
type Endpoint = { path: number[]; type: 'text' | 'element'; offset: number };
type SelectionDescriptor =
  | { kind: 'none' }
  | {
      kind: 'range';
      anchor: Endpoint;
      focus: Endpoint;
      format: number;
      style: string;
    }
  | { kind: 'table'; table: number[]; anchor: number[]; focus: number[] }
  | { kind: 'node'; nodes: number[][] };
interface Outcome {
  json: unknown;
  selection: SelectionDescriptor;
}
interface Scenario {
  name: string;
  rows: CellSpec[][];
  live: Live;
  tracked: Coordinate;
  action: TableMoveMenuAction;
}

const PLAIN: CellSpec[][] = [
  [{ text: 'A1' }, { text: 'A2' }],
  [{ text: 'B1' }, { text: 'B2' }],
  [{ text: 'C1' }, { text: 'C2' }],
];
const MERGED_COLUMNS: CellSpec[][] = [
  [{ text: 'A', colSpan: 2 }],
  [{ text: 'B1' }, { text: 'B2' }],
  [{ text: 'C1' }, { text: 'C2' }],
];
const MERGED_ROWS: CellSpec[][] = [
  [{ text: 'A1', rowSpan: 2 }, { text: 'A2' }],
  [{ text: 'B2' }],
  [{ text: 'C1' }, { text: 'C2' }],
];
const SCENARIOS: Scenario[] = [
  {
    name: 'tie: anchor and focus in one row, insert below',
    rows: PLAIN,
    live: { kind: 'table', anchor: [1, 0], focus: [1, 1] },
    tracked: [1, 0],
    action: 'insert-row-below',
  },
  {
    name: 'tie: anchor and focus in one column, insert right',
    rows: PLAIN,
    live: { kind: 'table', anchor: [0, 1], focus: [2, 1] },
    tracked: [0, 1],
    action: 'insert-column-right',
  },
  {
    name: 'backward table selection, insert above',
    rows: PLAIN,
    live: { kind: 'table', anchor: [2, 1], focus: [1, 0] },
    tracked: [2, 1],
    action: 'insert-row-above',
  },
  {
    name: 'backward table selection, insert left',
    rows: PLAIN,
    live: { kind: 'table', anchor: [1, 1], focus: [0, 0] },
    tracked: [1, 1],
    action: 'insert-column-left',
  },
  {
    name: 'merged column span, insert below',
    rows: MERGED_COLUMNS,
    live: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
    tracked: [0, 0],
    action: 'insert-row-below',
  },
  {
    name: 'merged row span anchor, insert below past its span',
    rows: MERGED_ROWS,
    live: { kind: 'table', anchor: [0, 0], focus: [0, 1] },
    tracked: [0, 0],
    action: 'insert-row-below',
  },
  {
    name: 'merged row span, insert right',
    rows: MERGED_ROWS,
    live: { kind: 'table', anchor: [0, 0], focus: [0, 0] },
    tracked: [0, 0],
    action: 'insert-column-right',
  },
  {
    name: 'merged cell, split',
    rows: MERGED_COLUMNS,
    live: { kind: 'caret', cell: [0, 0] },
    tracked: [0, 0],
    action: 'split-cell',
  },
  {
    name: 'range caret in a cell, insert below',
    rows: PLAIN,
    live: { kind: 'caret', cell: [1, 1] },
    tracked: [1, 1],
    action: 'insert-row-below',
  },
  {
    name: 'range caret in a cell, delete column',
    rows: PLAIN,
    live: { kind: 'caret', cell: [0, 1] },
    tracked: [0, 1],
    action: 'delete-column',
  },
  {
    name: 'table selection, delete row covers both rows',
    rows: PLAIN,
    live: { kind: 'table', anchor: [0, 0], focus: [1, 1] },
    tracked: [0, 0],
    action: 'delete-row',
  },
  {
    name: 'caret outside the table falls back to the tracked cell, insert below',
    rows: PLAIN,
    live: { kind: 'outside' },
    tracked: [1, 0],
    action: 'insert-row-below',
  },
  {
    name: 'caret outside the table falls back to the tracked cell, delete row',
    rows: PLAIN,
    live: { kind: 'outside' },
    tracked: [2, 1],
    action: 'delete-row',
  },
  {
    name: 'delete table',
    rows: PLAIN,
    live: { kind: 'caret', cell: [0, 0] },
    tracked: [0, 0],
    action: 'delete-table',
  },
];
const columnCount = (rows: CellSpec[][]) =>
  Math.max(
    ...rows.map((cells) =>
      cells.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0)
    )
  );
function stateJSON(rows: CellSpec[][]) {
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'table',
          version: 1,
          // Explicit, because native import fills default widths for a merged
          // table that Source leaves unset (a separate import finding).
          colWidths: Array.from({ length: columnCount(rows) }, () => 120),
          children: rows.map((cells) => ({
            type: 'tablerow',
            version: 1,
            children: cells.map((spec) => ({
              type: 'tablecell',
              version: 1,
              colSpan: spec.colSpan ?? 1,
              rowSpan: spec.rowSpan ?? 1,
              children: [
                {
                  type: 'paragraph',
                  version: 1,
                  children: [{ type: 'text', version: 1, text: spec.text }],
                },
              ],
            })),
          })),
        },
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text: 'after' }],
        },
      ],
    },
  });
}
/** Engine-local `$` id metadata removed; every other key and value kept. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$')
      .map(([key, item]) => [key, normalize(item)])
  );
}

// --- Source -------------------------------------------------------------

function $tableRows() {
  const table = $getRoot().getChildren().find($isTableNode);
  return table ? table.getChildren().filter($isTableRowNode) : [];
}
function $cellAt([row, column]: Coordinate): TableCellNode {
  const cell = $tableRows()[row]?.getChildren()[column];
  if (!$isTableCellNode(cell)) throw new Error('Missing Source cell');
  return cell;
}
function $path(node: LexicalNode): number[] {
  const path: number[] = [];
  let current: LexicalNode | null = node;
  while (current && current.getParent()) {
    path.unshift(current.getIndexWithinParent());
    current = current.getParent();
  }
  return path;
}
function $endpoint(point: PointType): Endpoint {
  return {
    path: $path(point.getNode()),
    type: point.type,
    offset: point.offset,
  };
}
function $cellPath(key: string): number[] {
  const node = $getNodeByKey(key);
  if (!node) throw new Error('Missing selected node');
  const cell = $getTableCellNodeFromLexicalNode(node);
  return $path(cell ?? node);
}
function $sourceSelection(): SelectionDescriptor {
  const selection = $getSelection();
  if ($isTableSelection(selection))
    return {
      kind: 'table',
      table: $path(
        $getTableNodeFromLexicalNodeOrThrow($cellAt([0, 0]).getLatest())
      ),
      anchor: $cellPath(selection.anchor.key),
      focus: $cellPath(selection.focus.key),
    };
  if ($isRangeSelection(selection))
    return {
      kind: 'range',
      anchor: $endpoint(selection.anchor),
      focus: $endpoint(selection.focus),
      format: selection.format,
      style: selection.style,
    };
  if ($isNodeSelection(selection))
    return { kind: 'node', nodes: selection.getNodes().map($path) };
  return { kind: 'none' };
}
function sourceOutcome(editor: LexicalEditor): Outcome {
  return {
    // The serialized form: own undefined values are dropped, as on storage.
    json: normalize(
      JSON.parse(JSON.stringify(editor.getEditorState().toJSON()))
    ),
    selection: editor.getEditorState().read($sourceSelection),
  };
}
function update(editor: LexicalEditor, fn: () => void) {
  return new Promise<void>((resolve) =>
    editor.update(fn, { onUpdate: () => resolve() })
  );
}
const $menuItem = (action: TableMoveMenuAction, cell: TableCellNode) =>
  match(action)
    .with('insert-column-left', () => $insertTableColumnAtSelection(false))
    .with('insert-column-right', () => $insertTableColumnAtSelection(true))
    .with('insert-row-below', () => $insertTableRowAtSelection(true))
    .with('insert-row-above', () => $insertTableRowAtSelection(false))
    .with('delete-row', () => $deleteTableRowAtSelection())
    .with('delete-column', () => $deleteTableColumnAtSelection())
    .with('split-cell', () => $unmergeCell())
    .with('delete-table', () =>
      $getTableNodeFromLexicalNodeOrThrow(cell).remove()
    )
    .exhaustive();

async function source(scenario: Scenario) {
  const editor = createTableTestEditor();
  cleanups.push(() => editor.getRootElement()?.remove());
  cleanups.push(registerHistory(editor, createEmptyHistoryState(), 0));
  await update(editor, () => {
    editor.setEditorState(editor.parseEditorState(stateJSON(scenario.rows)));
  });
  await update(editor, () => {
    const live = scenario.live;
    if (live.kind === 'table') {
      const selection = $createTableSelection();
      const anchor = $cellAt(live.anchor);
      selection.set(
        $getTableNodeFromLexicalNodeOrThrow(anchor).getKey(),
        anchor.getKey(),
        $cellAt(live.focus).getKey()
      );
      $setSelection(selection);
    } else if (live.kind === 'caret') $cellAt(live.cell).selectStart();
    else $getRoot().getLastChildOrThrow().selectEnd();
  });
  const before = sourceOutcome(editor);
  await update(editor, () => {
    // TableMoveHandle runMenuAction, verbatim in shape.
    const selection = $getSelection();
    let cell =
      $isRangeSelection(selection) || $isTableSelection(selection)
        ? $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
        : null;
    if (!cell) {
      const tracked = $cellAt(scenario.tracked);
      if (tracked.isAttached()) {
        tracked.selectStart();
        cell = tracked;
      }
    }
    if (cell) $menuItem(scenario.action, cell);
  });
  const after = sourceOutcome(editor);
  const undone = new Promise<void>((resolve) => {
    const off = editor.registerUpdateListener(() => {
      off();
      resolve();
    });
  });
  editor.dispatchCommand(UNDO_COMMAND, undefined);
  await undone;
  return { before, after, undone: sourceOutcome(editor) };
}

// --- Native -------------------------------------------------------------

function nativeMount(rows: CellSpec[][]) {
  const fixture = nativeSurface();
  cleanups.push(() => fixture.close());
  fixture.port.setState(stateJSON(rows));
  fixture.root.contentEditable = 'true';
  fixture.port.command(CommandCode.ClearHistory);
  return fixture;
}
type NativeFixture = ReturnType<typeof nativeMount>;
function nativeCell(fixture: NativeFixture, [row, column]: Coordinate) {
  const element = fixture.root
    .querySelectorAll('tr')
    [row]?.querySelectorAll('td,th')[column];
  const key = element ? fixture.view.keyFromDOM(element) : null;
  if (key === null) throw new Error('Missing native cell');
  return key;
}
function nativePath(fixture: NativeFixture, key: number): number[] {
  const path: number[] = [];
  let current = fixture.view.node(key);
  while (current && current.parent !== null) {
    const parent = fixture.view.node(current.parent);
    if (!parent) break;
    path.unshift(parent.children.indexOf(current.key));
    current = parent;
  }
  return path;
}
function nativeOutcome(fixture: NativeFixture): Outcome {
  const json = normalize(JSON.parse(fixture.view.query.serializedState()));
  const info = fixture.view.selection();
  const selection = info.selection;
  const endpoint = (point: {
    key: number;
    offset: number;
    type: 'text' | 'element';
  }) => ({
    path: nativePath(fixture, point.key),
    type: point.type,
    offset: point.offset,
  });
  const descriptor: SelectionDescriptor = match(selection)
    .with({ kind: 'range' }, (range) => ({
      kind: 'range' as const,
      anchor: endpoint(range.anchor),
      focus: endpoint(range.focus),
      format: info.format,
      style: info.style,
    }))
    .with({ kind: 'table' }, (table) => ({
      kind: 'table' as const,
      table: nativePath(fixture, table.table),
      anchor: nativePath(fixture, table.anchorCell),
      focus: nativePath(fixture, table.focusCell),
    }))
    .with({ kind: 'node' }, (node) => ({
      kind: 'node' as const,
      nodes: node.keys.map((key) => nativePath(fixture, key)),
    }))
    .with({ kind: 'none' }, { kind: 'keep' }, () => ({ kind: 'none' as const }))
    .exhaustive();
  return { json, selection: descriptor };
}
function nativeLive(fixture: NativeFixture, live: Live) {
  const textIn = (cell: number) => {
    const text = [...fixture.view.mirror.values()].find(
      (node) =>
        node.kind === 'text' &&
        node.parent !== null &&
        fixture.view.node(node.parent)?.parent === cell
    );
    if (!text) throw new Error('Missing native cell text');
    return text.key;
  };
  const caret = (key: number, offset: number) =>
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key, offset, type: 'text' },
      focus: { key, offset, type: 'text' },
    });
  if (live.kind === 'table') {
    const table = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'table'
    );
    if (!table) throw new Error('Missing native table');
    fixture.port.selectionFromView({
      kind: 'table',
      table: table.key,
      anchorCell: nativeCell(fixture, live.anchor),
      focusCell: nativeCell(fixture, live.focus),
    });
  } else if (live.kind === 'caret')
    caret(textIn(nativeCell(fixture, live.cell)), 0);
  else {
    const after = [...fixture.view.mirror.values()].find(
      (node) => node.kind === 'text' && node.text === 'after'
    );
    if (!after) throw new Error('Missing outside text');
    caret(after.key, 5);
  }
}

for (const scenario of SCENARIOS) {
  test(`Source oracle is self-consistent: ${scenario.name}`, async () => {
    const { before, after, undone } = await source(scenario);
    expect(after).not.toEqual(before);
    // One fixture-history undo restores the whole document on Source.
    expect(undone.json).toEqual(before.json);
  });

  test(`(e) native menu equals Source after the action and after one undo: ${scenario.name}`, async () => {
    const expected = await source(scenario);
    const fixture = nativeMount(scenario.rows);
    const host = createNativeTableMoveHost(fixture.view, () => true);
    cleanups.push(() => host.dispose());
    nativeLive(fixture, scenario.live);
    expect(nativeOutcome(fixture)).toEqual(expected.before);
    const generation = fixture.view.mirror.keyGeneration;
    if (generation === null) throw new Error('No native generation');
    const tracked = {
      index: nativeCell(fixture, scenario.tracked),
      generation,
    };
    // The host's own settlement, awaited before any comparison or undo.
    await host.menuAction(scenario.action, {
      anchor: tracked,
      focus: tracked,
      merged: false,
    });
    expect(nativeOutcome(fixture)).toEqual(expected.after);
    fixture.port.command(CommandCode.Undo);
    expect(nativeOutcome(fixture)).toEqual(expected.undone);
  });
}
