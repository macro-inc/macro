/** @vitest-environment jsdom */
/**
 * Touch handle menu parity, Source against native. The Source side is a
 * literal copy of TableMoveHandle runMenuAction (live Range/Table anchor cell,
 * else tracked.selectStart(), then the item's Lexical call) in one update.
 * Native runs the move host. Both then undo once. Grid, selection after the
 * action, and grid and selection after undo are compared by cell coordinate.
 */
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
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
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type LexicalEditor,
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
type SelectionSummary =
  | { kind: 'table'; anchor: Coordinate; focus: Coordinate }
  | { kind: 'caret'; cell: Coordinate }
  | { kind: 'outside-or-none' };
interface Outcome {
  grid: string[][];
  selection: SelectionSummary;
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
function $coordinate(cell: TableCellNode): Coordinate {
  const row = cell.getParent();
  if (!$isTableRowNode(row)) throw new Error('Cell outside a row');
  return [$tableRows().indexOf(row), row.getChildren().indexOf(cell)];
}
function $sourceSelection(): SelectionSummary {
  const selection = $getSelection();
  if ($isTableSelection(selection)) {
    const anchor = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
    const focus = $getTableCellNodeFromLexicalNode(selection.focus.getNode());
    if (anchor && focus)
      return {
        kind: 'table',
        anchor: $coordinate(anchor),
        focus: $coordinate(focus),
      };
  }
  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    const cell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
    if (cell) return { kind: 'caret', cell: $coordinate(cell) };
  }
  return { kind: 'outside-or-none' };
}
function sourceOutcome(editor: LexicalEditor): Outcome {
  return editor.getEditorState().read(() => ({
    grid: $tableRows().map((row) =>
      row.getChildren().map((cell) => cell.getTextContent())
    ),
    selection: $sourceSelection(),
  }));
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
    const table = $createTableNode();
    for (const cells of scenario.rows) {
      const row = $createTableRowNode();
      for (const spec of cells) {
        const cell = $createTableCellNode(0, spec.colSpan ?? 1).setRowSpan(
          spec.rowSpan ?? 1
        );
        cell.append($createParagraphNode().append($createTextNode(spec.text)));
        row.append(cell);
      }
      table.append(row);
    }
    $getRoot()
      .clear()
      .append(table, $createParagraphNode().append($createTextNode('after')));
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
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'table',
            version: 1,
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
    })
  );
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
function nativeCoordinate(fixture: NativeFixture, key: number) {
  let current = fixture.view.node(key);
  while (current && current.type !== 'tablecell')
    current =
      current.parent === null ? null : fixture.view.node(current.parent);
  const cell = current ? fixture.view.getElementByKey(current.key) : null;
  const row = cell?.parentElement;
  if (!cell || !(row instanceof HTMLTableRowElement)) return undefined;
  const coordinate: Coordinate = [
    [...fixture.root.querySelectorAll('tr')].indexOf(row),
    [...row.children].indexOf(cell),
  ];
  return coordinate;
}
function nativeOutcome(fixture: NativeFixture): Outcome {
  const grid = [...fixture.root.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('td,th')].map((cell) => cell.textContent ?? '')
  );
  const selection = fixture.view.selection().selection;
  if (selection?.kind === 'table') {
    const anchor = nativeCoordinate(fixture, selection.anchorCell);
    const focus = nativeCoordinate(fixture, selection.focusCell);
    if (anchor && focus)
      return { grid, selection: { kind: 'table', anchor, focus } };
  }
  if (
    selection?.kind === 'range' &&
    selection.anchor.key === selection.focus.key &&
    selection.anchor.offset === selection.focus.offset
  ) {
    const cell = nativeCoordinate(fixture, selection.anchor.key);
    if (cell) return { grid, selection: { kind: 'caret', cell } };
  }
  return { grid, selection: { kind: 'outside-or-none' } };
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
    const { before, undone } = await source(scenario);
    // One undo restores the grid on Source; the selection oracle is recorded.
    expect(undone.grid).toEqual(before.grid);
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
    host.menuAction(scenario.action, {
      anchor: tracked,
      focus: tracked,
      merged: false,
    });
    expect(nativeOutcome(fixture)).toEqual(expected.after);
    fixture.port.command(CommandCode.Undo);
    expect(nativeOutcome(fixture)).toEqual(expected.undone);
  });
}
