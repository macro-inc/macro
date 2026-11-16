/** @vitest-environment jsdom */
/**
 * Source vs native selection after the touch menu's insert items. The Source
 * side runs the items' actual Lexical calls ($insertTableRowAtSelection /
 * $insertTableColumnAtSelection under the live selection, as TableMoveHandle
 * runMenuAction does); the native side runs the existing group-b.table
 * command with the Source rule's cell. Grid and selection are compared by
 * cell coordinates.
 */
import {
  $createTableSelection,
  $getTableCellNodeFromLexicalNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableRowNode,
  $isTableSelection,
  type TableCellNode,
} from '@lexical/table';
import { $getSelection, $isRangeSelection, $setSelection } from 'lexical';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { createNativeTableMoveHost } from '../../editing/overlay-hosts/native-table-move';
import {
  initializeNativeTableTests,
  nativeTableSurface,
  restoreNativeTableTests,
} from '../../editing/overlay-hosts/native-table-test-fixture';
import type { TableMoveMenuAction } from '../../editing/overlay-hosts/table-move';
import { insertNativeTableAxis } from './native';
import {
  $getTable,
  buildTable,
  createTableTestEditor,
  readCellTexts,
  textGrid,
} from './tableTestUtils';

beforeAll(initializeNativeTableTests);
afterAll(restoreNativeTableTests);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Coordinate = [row: number, column: number];
type SelectionSummary =
  | { kind: 'table'; anchor: Coordinate; focus: Coordinate }
  | { kind: 'caret'; cell: Coordinate }
  | { kind: 'other' };
interface Outcome {
  grid: string[][];
  selection: SelectionSummary;
}
const GRID = [
  ['A1', 'A2'],
  ['B1', 'B2'],
  ['C1', 'C2'],
];

function $coordinate(cell: TableCellNode): Coordinate {
  const row = cell.getParent();
  if (!$isTableRowNode(row)) throw new Error('Cell outside a row');
  const rowIndex = $getTable().getChildren().indexOf(row);
  return [rowIndex, row.getChildren().indexOf(cell)];
}
function $sourceSelection(): SelectionSummary {
  const selection = $getSelection();
  if ($isTableSelection(selection)) {
    const anchor = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
    const focus = $getTableCellNodeFromLexicalNode(selection.focus.getNode());
    if (!anchor || !focus) return { kind: 'other' };
    return {
      kind: 'table',
      anchor: $coordinate(anchor),
      focus: $coordinate(focus),
    };
  }
  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    const cell = $getTableCellNodeFromLexicalNode(selection.anchor.getNode());
    return cell
      ? { kind: 'caret', cell: $coordinate(cell) }
      : { kind: 'other' };
  }
  return { kind: 'other' };
}

/** Source: live table selection anchor..focus, then the menu item's Lexical call. */
async function source(
  anchor: Coordinate,
  focus: Coordinate,
  action: TableMoveMenuAction
): Promise<Outcome> {
  const editor = createTableTestEditor();
  cleanups.push(() => editor.getRootElement()?.remove());
  await buildTable(editor, textGrid(GRID));
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const rows = $getTable().getChildren().filter($isTableRowNode);
        const cellAt = ([row, column]: Coordinate) => {
          const cell = rows[row]?.getChildren()[column];
          if (!$isTableCellNode(cell)) throw new Error('Missing Source cell');
          return cell;
        };
        const selection = $createTableSelection();
        selection.set(
          $getTable().getKey(),
          cellAt(anchor).getKey(),
          cellAt(focus).getKey()
        );
        $setSelection(selection);
      },
      { onUpdate: () => resolve() }
    );
  });
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        if (action === 'insert-row-below') $insertTableRowAtSelection(true);
        else if (action === 'insert-row-above')
          $insertTableRowAtSelection(false);
        else if (action === 'insert-column-right')
          $insertTableColumnAtSelection(true);
        else if (action === 'insert-column-left')
          $insertTableColumnAtSelection(false);
        else throw new Error(`Not an insert item: ${action}`);
      },
      { onUpdate: () => resolve() }
    );
  });
  return {
    grid: readCellTexts(editor),
    selection: editor.getEditorState().read($sourceSelection),
  };
}

function nativeMount() {
  const fixture = nativeTableSurface();
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
            children: GRID.map((cells) => ({
              type: 'tablerow',
              version: 1,
              children: cells.map((text) => ({
                type: 'tablecell',
                version: 1,
                children: [
                  {
                    type: 'paragraph',
                    version: 1,
                    children: [{ type: 'text', version: 1, text }],
                  },
                ],
              })),
            })),
          },
        ],
      },
    })
  );
  fixture.root.contentEditable = 'true';
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
function nativeCoordinate(fixture: NativeFixture, key: number): Coordinate {
  let current = fixture.view.node(key);
  while (current && current.type !== 'tablecell')
    current =
      current.parent === null ? null : fixture.view.node(current.parent);
  const cell = current ? fixture.view.getElementByKey(current.key) : null;
  const row = cell?.parentElement;
  const rows = [...fixture.root.querySelectorAll('tr')];
  if (!cell || !(row instanceof HTMLTableRowElement))
    throw new Error('Selection outside a native cell');
  return [rows.indexOf(row), [...row.children].indexOf(cell)];
}
function nativeOutcome(fixture: NativeFixture): Outcome {
  const grid = [...fixture.root.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('td,th')].map((cell) => cell.textContent ?? '')
  );
  const selection = fixture.view.selection().selection;
  if (selection?.kind === 'table')
    return {
      grid,
      selection: {
        kind: 'table',
        anchor: nativeCoordinate(fixture, selection.anchorCell),
        focus: nativeCoordinate(fixture, selection.focusCell),
      },
    };
  if (
    selection?.kind === 'range' &&
    selection.anchor.key === selection.focus.key &&
    selection.anchor.offset === selection.focus.offset
  )
    return {
      grid,
      selection: {
        kind: 'caret',
        cell: nativeCoordinate(fixture, selection.anchor.key),
      },
    };
  return { grid, selection: { kind: 'other' } };
}
function nativeSelect(
  fixture: NativeFixture,
  anchor: Coordinate,
  focus: Coordinate
) {
  const table = [...fixture.view.mirror.values()].find(
    (node) => node.type === 'table'
  );
  if (!table) throw new Error('Missing native table');
  fixture.port.selectionFromView({
    kind: 'table',
    table: table.key,
    anchorCell: nativeCell(fixture, anchor),
    focusCell: nativeCell(fixture, focus),
  });
}

/** The Source rule's cell for an insert, by coordinate (no spans in GRID). */
function ruleCell(
  anchor: Coordinate,
  focus: Coordinate,
  axis: 0 | 1,
  after: boolean
): Coordinate {
  if (after) return anchor[axis] + 1 > focus[axis] + 1 ? anchor : focus;
  return focus[axis] < anchor[axis] ? focus : anchor;
}

const CASES = [
  {
    action: 'insert-row-below',
    anchor: [0, 0],
    focus: [1, 1],
    axis: 0,
    after: true,
  },
  {
    action: 'insert-row-above',
    anchor: [2, 0],
    focus: [1, 1],
    axis: 0,
    after: false,
  },
  {
    action: 'insert-column-right',
    anchor: [0, 0],
    focus: [1, 0],
    axis: 1,
    after: true,
  },
  {
    action: 'insert-column-left',
    anchor: [0, 1],
    focus: [1, 1],
    axis: 1,
    after: false,
  },
] as const satisfies ReadonlyArray<{
  action: TableMoveMenuAction;
  anchor: Coordinate;
  focus: Coordinate;
  axis: 0 | 1;
  after: boolean;
}>;

for (const item of CASES) {
  test(`characterization: ${item.action} with the rule cell matches the Source grid; selection recorded`, async () => {
    const expected = await source(
      [...item.anchor],
      [...item.focus],
      item.action
    );
    const fixture = nativeMount();
    nativeSelect(fixture, [...item.anchor], [...item.focus]);
    const cell = ruleCell(
      [...item.anchor],
      [...item.focus],
      item.axis,
      item.after
    );
    insertNativeTableAxis(
      fixture.view,
      nativeCell(fixture, cell),
      item.axis === 0 ? 'row' : 'column',
      item.after
    );
    const actual = nativeOutcome(fixture);
    expect(actual.grid).toEqual(expected.grid);
    // Rows: Source keeps the live table selection, native carets the new
    // row. Columns: both caret the first inserted cell.
    if (item.axis === 0) {
      expect(expected.selection.kind).toBe('table');
      expect(actual.selection).not.toEqual(expected.selection);
    } else expect(actual.selection).toEqual(expected.selection);
  });

  test(`(e) move host ${item.action}: native grid AND selection equal Source`, async () => {
    const expected = await source(
      [...item.anchor],
      [...item.focus],
      item.action
    );
    const fixture = nativeMount();
    const host = createNativeTableMoveHost(fixture.view, () => true);
    cleanups.push(() => host.dispose());
    nativeSelect(fixture, [...item.anchor], [...item.focus]);
    await host.menuAction(item.action, host.trackedCells());
    expect(nativeOutcome(fixture)).toEqual(expected);
  });
}
