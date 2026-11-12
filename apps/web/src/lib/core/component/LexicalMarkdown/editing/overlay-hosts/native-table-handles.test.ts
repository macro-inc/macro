/** @vitest-environment jsdom */
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { insertNativeTableAxis } from '../../plugins/tables/native';
import { createNativeTableMoveHost } from './native-table-move';
import { createNativeTableResizeHost } from './native-table-resize';

beforeAll(initializeNativeSurfaceTests);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mount(rows: string[][], colWidths?: number[]) {
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
            ...(colWidths ? { colWidths } : {}),
            children: rows.map((cells) => ({
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
  return fixture;
}
type Fixture = ReturnType<typeof mount>;
const cellKeys = (fixture: Fixture) =>
  [...fixture.view.mirror.values()]
    .filter((node) => node.type === 'tablecell')
    .map((node) => node.key);
const tableKey = (fixture: Fixture) => {
  const table = [...fixture.view.mirror.values()].find(
    (node) => node.type === 'table'
  );
  if (!table) throw new Error('Missing table');
  return table.key;
};
function cellElement(fixture: Fixture, index: number) {
  const cell = fixture.root.querySelectorAll('td,th')[index];
  if (!(cell instanceof HTMLElement)) throw new Error('Missing cell element');
  return cell;
}
const rowTexts = (fixture: Fixture) =>
  [...fixture.root.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('td,th')].map((cell) => cell.textContent ?? '')
  );
function serializedTable(fixture: Fixture) {
  const state: unknown = JSON.parse(fixture.view.query.serializedState());
  if (
    !state ||
    typeof state !== 'object' ||
    !('root' in state) ||
    !state.root ||
    typeof state.root !== 'object' ||
    !('children' in state.root) ||
    !Array.isArray(state.root.children)
  )
    throw new Error('Unexpected serialized state');
  const table: unknown = state.root.children[0];
  if (!table || typeof table !== 'object')
    throw new Error('Missing serialized table');
  return table;
}
const widths = (fixture: Fixture) => {
  const table = serializedTable(fixture);
  return 'colWidths' in table ? table.colWidths : 'missing';
};
function textIn(fixture: Fixture, cell: number) {
  const text = [...fixture.view.mirror.values()].find(
    (node) =>
      node.kind === 'text' &&
      node.parent !== null &&
      fixture.view.node(node.parent)?.parent === cell
  );
  if (!text) throw new Error('Missing cell text');
  return text.key;
}
function caretIn(fixture: Fixture, cell: number) {
  const key = textIn(fixture, cell);
  fixture.port.selectionFromView({
    kind: 'range',
    anchor: { key, offset: 0, type: 'text' },
    focus: { key, offset: 0, type: 'text' },
  });
}

// --- Resize host (TableCellResizer backend) -------------------------------

test('resize host: a target inside a cell resolves that cell; outside the table clears', () => {
  const fixture = mount([['A', 'B']]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const text = cellElement(fixture, 1).querySelector('span')?.firstChild;
  if (!text) throw new Error('Missing cell text node');
  expect(host.cellFromTarget(text)?.element).toBe(cellElement(fixture, 1));
  const after = [...fixture.root.querySelectorAll('p')].at(-1);
  expect(host.cellFromTarget(after ?? null)).toBeUndefined();
  expect(host.cellFromTarget(null)).toBeNull();
});

test('resize host: a column drag applies live, merges, and restores the stored widths', () => {
  const fixture = mount([['A', 'B']], [100, 100]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  const drag = host.beginDrag(cell, 'right', 1);
  expect(drag?.axis).toBe('column');
  drag?.apply(40);
  drag?.apply(60);
  expect(widths(fixture)).toEqual([160, 100]);
  drag?.restore();
  expect(widths(fixture)).toEqual([100, 100]);
});

test('resize host: a left-edge drag resizes the previous column; the first column refuses', () => {
  const fixture = mount([['A', 'B']], [100, 100]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const first = host.cellFromTarget(cellElement(fixture, 0));
  const second = host.cellFromTarget(cellElement(fixture, 1));
  if (!first || !second) throw new Error('Missing hits');
  expect(host.beginDrag(first, 'left', 1)).toBeUndefined();
  host.beginDrag(second, 'left', 1)?.apply(25);
  expect(widths(fixture)).toEqual([125, 100]);
});

test('resize host: a row drag sets the height and restores the unset height', () => {
  const fixture = mount([['A'], ['B']]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const before = fixture.view.query.serializedState();
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  const drag = host.beginDrag(cell, 'bottom', 1);
  expect(drag?.axis).toBe('row');
  drag?.apply(30);
  expect(fixture.view.query.serializedState()).not.toBe(before);
  drag?.restore();
  expect(fixture.view.query.serializedState()).toBe(before);
});

test('resize host: refused without edit; isEditable follows canEdit and the root', () => {
  let canEdit = false;
  const fixture = mount([['A', 'B']], [100, 100]);
  const host = createNativeTableResizeHost(fixture.view, () => canEdit);
  cleanups.push(() => host.dispose());
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  expect(host.isEditable()).toBe(false);
  expect(host.beginDrag(cell, 'right', 1)).toBeUndefined();
  canEdit = true;
  expect(host.isEditable()).toBe(true);
  fixture.root.contentEditable = 'false';
  expect(host.isEditable()).toBe(false);
  expect(widths(fixture)).toEqual([100, 100]);
});

test('resize host: a drag whose table is replaced stops applying', () => {
  const fixture = mount([['A', 'B']], [100, 100]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  const drag = host.beginDrag(cell, 'right', 1);
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [{ type: 'paragraph', version: 1, children: [] }],
      },
    })
  );
  const after = fixture.view.query.serializedState();
  drag?.apply(40);
  drag?.restore();
  expect(fixture.view.query.serializedState()).toBe(after);
});

test('resize host: elementFor re-resolves the cell after its row DOM is recreated', () => {
  const fixture = mount([['A'], ['B']]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  host.beginDrag(cell, 'bottom', 1)?.apply(30);
  const current = host.elementFor(cell);
  expect(current?.isConnected).toBe(true);
  expect(current && fixture.view.keyFromDOM(current)).toBe(cell.key.index);
});

test('resize host: layout listeners fire on model commits and stop after release', () => {
  const fixture = mount([['A', 'B']], [100, 100]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  let bumps = 0;
  const release = host.registerLayout(() => bumps++);
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  host.beginDrag(cell, 'right', 1)?.apply(10);
  expect(bumps).toBeGreaterThan(0);
  const seen = bumps;
  release();
  host.beginDrag(cell, 'right', 1)?.apply(20);
  expect(bumps).toBe(seen);
});

// --- Move host (TableMoveHandle backend) ----------------------------------

test('move host: tracked cells follow a table selection, a caret cell, and clear outside', () => {
  const fixture = mount([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [a, , , d] = cellKeys(fixture);
  if (a === undefined || d === undefined) throw new Error('Missing cells');
  fixture.port.selectionFromView({
    kind: 'table',
    table: tableKey(fixture),
    anchorCell: a,
    focusCell: d,
  });
  const tracked = host.trackedCells();
  expect(tracked && [tracked.anchor.index, tracked.focus.index]).toEqual([
    a,
    d,
  ]);
  expect(tracked?.merged).toBe(false);
  expect(tracked && host.shape(tracked)).toEqual({ rows: 2, columns: 2 });
  caretIn(fixture, d);
  const caret = host.trackedCells();
  expect(caret && [caret.anchor.index, caret.focus.index]).toEqual([d, d]);
  const after = [...fixture.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === 'after'
  );
  if (!after) throw new Error('Missing outside text');
  fixture.port.selectionFromView({
    kind: 'range',
    anchor: { key: after.key, offset: 0, type: 'text' },
    focus: { key: after.key, offset: 0, type: 'text' },
  });
  expect(host.trackedCells()).toBeUndefined();
});

test('move host: dragging the handle moves the range onto the dropped cell', () => {
  const fixture = mount([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [a] = cellKeys(fixture);
  if (a === undefined) throw new Error('Missing cells');
  caretIn(fixture, a);
  const tracked = host.trackedCells();
  if (!tracked) throw new Error('Missing tracked cells');
  expect(host.move(tracked, cellElement(fixture, 3))).toBe(true);
  expect(rowTexts(fixture)).toEqual([
    ['', 'B'],
    ['C', 'A'],
  ]);
});

test('move host: a desktop tap selects the tracked cells as a table selection', () => {
  const fixture = mount([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [a] = cellKeys(fixture);
  if (a === undefined) throw new Error('Missing cells');
  caretIn(fixture, a);
  const tracked = host.trackedCells();
  if (!tracked) throw new Error('Missing tracked cells');
  host.selectCells(tracked);
  expect(fixture.view.selection().selection).toEqual({
    kind: 'table',
    table: tableKey(fixture),
    anchorCell: a,
    focusCell: a,
  });
});

// --- Gap (e): touch menu actions use the live selection (Source runMenuAction)

test('(e) characterization: native insert-row under a two-row table selection inserts after the given cell', () => {
  // The existing command select_starts its cell, so it inserts after the
  // anchor row. Source's touch menu calls $insertTableRowAtSelection(true),
  // which inserts after the lower of the anchor and focus rows.
  const fixture = mount([['A'], ['B'], ['C']]);
  const [a, b] = cellKeys(fixture);
  if (a === undefined || b === undefined) throw new Error('Missing cells');
  fixture.port.selectionFromView({
    kind: 'table',
    table: tableKey(fixture),
    anchorCell: a,
    focusCell: b,
  });
  insertNativeTableAxis(fixture.view, a, 'row', true);
  expect(rowTexts(fixture)).toEqual([['A'], [''], ['B'], ['C']]);
});

test('(e) touch menu "Insert row below" under a two-row table selection inserts below the selection, as Source', () => {
  const fixture = mount([['A'], ['B'], ['C']]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [a, b] = cellKeys(fixture);
  if (a === undefined || b === undefined) throw new Error('Missing cells');
  fixture.port.selectionFromView({
    kind: 'table',
    table: tableKey(fixture),
    anchorCell: a,
    focusCell: b,
  });
  host.menuAction('insert-row-below', host.trackedCells());
  expect(rowTexts(fixture)).toEqual([['A'], ['B'], [''], ['C']]);
});

test('(e) touch menu "Insert row above" under a backward two-row selection inserts above the upper row, as Source', () => {
  const fixture = mount([['A'], ['B'], ['C']]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [, b, c] = cellKeys(fixture);
  if (b === undefined || c === undefined) throw new Error('Missing cells');
  fixture.port.selectionFromView({
    kind: 'table',
    table: tableKey(fixture),
    anchorCell: c,
    focusCell: b,
  });
  host.menuAction('insert-row-above', host.trackedCells());
  expect(rowTexts(fixture)).toEqual([['A'], [''], ['B'], ['C']]);
});

test('(e) touch menu "Delete row" under a table selection deletes every covered row, as Source', () => {
  // Matches both Source $deleteTableRowAtSelection and the native hover delete.
  const fixture = mount([['A'], ['B'], ['C']]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [a, b] = cellKeys(fixture);
  if (a === undefined || b === undefined) throw new Error('Missing cells');
  fixture.port.selectionFromView({
    kind: 'table',
    table: tableKey(fixture),
    anchorCell: a,
    focusCell: b,
  });
  host.menuAction('delete-row', host.trackedCells());
  expect(rowTexts(fixture)).toEqual([['C']]);
});

test('(e) touch menu with the live selection outside the table acts on the tracked anchor cell only', () => {
  const fixture = mount([['A'], ['B'], ['C']]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [, b] = cellKeys(fixture);
  if (b === undefined) throw new Error('Missing cells');
  caretIn(fixture, b);
  const tracked = host.trackedCells();
  const after = [...fixture.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === 'after'
  );
  if (!after) throw new Error('Missing outside text');
  fixture.port.selectionFromView({
    kind: 'range',
    anchor: { key: after.key, offset: 0, type: 'text' },
    focus: { key: after.key, offset: 0, type: 'text' },
  });
  host.menuAction('delete-row', tracked);
  expect(rowTexts(fixture)).toEqual([['A'], ['C']]);
});

test('(e) touch menu "Delete table" removes the whole table', () => {
  const fixture = mount([['A'], ['B']]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [a] = cellKeys(fixture);
  if (a === undefined) throw new Error('Missing cells');
  caretIn(fixture, a);
  host.menuAction('delete-table', host.trackedCells());
  expect(fixture.root.querySelector('table')).toBeNull();
});
