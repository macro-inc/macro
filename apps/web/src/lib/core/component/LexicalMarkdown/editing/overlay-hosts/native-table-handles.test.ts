/** @vitest-environment jsdom */

import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { insertNativeTableAxis } from '../../plugins/tables/native';
import { createNativeTableMoveHost } from './native-table-move';
import { createNativeTableResizeHost } from './native-table-resize';
import {
  initializeNativeTableTests,
  nativeTableSurface,
  restoreNativeTableTests,
} from './native-table-test-fixture';

beforeAll(initializeNativeTableTests);
afterAll(restoreNativeTableTests);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function mount(rows: string[][], colWidths?: number[]) {
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

test('resize host: a target inside a cell resolves that cell; outside the table clears', async () => {
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

test('resize host: a column drag applies live, merges, and restores the stored widths', async () => {
  const fixture = mount([['A', 'B']], [100, 100]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  const drag = host.beginDrag(cell, 'right', 1);
  expect(drag?.axis).toBe('column');
  drag?.apply(40);
  drag?.apply(60);
  await drag?.settled();
  expect(widths(fixture)).toEqual([160, 100]);
  drag?.restore();
  await drag?.settled();
  expect(widths(fixture)).toEqual([100, 100]);
});

test('resize host: a left-edge drag resizes the previous column; the first column refuses', async () => {
  const fixture = mount([['A', 'B']], [100, 100]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const first = host.cellFromTarget(cellElement(fixture, 0));
  const second = host.cellFromTarget(cellElement(fixture, 1));
  if (!first || !second) throw new Error('Missing hits');
  expect(host.beginDrag(first, 'left', 1)).toBeUndefined();
  const drag = host.beginDrag(second, 'left', 1);
  drag?.apply(25);
  await drag?.settled();
  expect(widths(fixture)).toEqual([125, 100]);
});

test('resize host: a row drag sets the height and restores the unset height', async () => {
  const fixture = mount([['A'], ['B']]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const before = fixture.view.query.serializedState();
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  const drag = host.beginDrag(cell, 'bottom', 1);
  expect(drag?.axis).toBe('row');
  drag?.apply(30);
  await drag?.settled();
  expect(fixture.view.query.serializedState()).not.toBe(before);
  drag?.restore();
  await drag?.settled();
  expect(fixture.view.query.serializedState()).toBe(before);
});

test('resize host: refused without edit; isEditable follows canEdit and the root', async () => {
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

test('resize host: a drag whose table is replaced stops applying', async () => {
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
  await drag?.settled();
  expect(fixture.view.query.serializedState()).toBe(after);
});

test('resize host: elementFor re-resolves the cell after its row DOM is recreated', async () => {
  const fixture = mount([['A'], ['B']]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  const drag = host.beginDrag(cell, 'bottom', 1);
  drag?.apply(30);
  await drag?.settled();
  const current = host.elementFor(cell);
  expect(current?.isConnected).toBe(true);
  expect(current && fixture.view.keyFromDOM(current)).toBe(cell.key.index);
});

test('resize host: layout listeners fire on model commits and root width changes, and stop after release', async () => {
  // Source registerLayout: editor updates plus the root's width observer.
  const observers: Array<{ fire: () => void; observed: Element[] }> = [];
  class TestResizeObserver {
    readonly observed: Element[] = [];
    constructor(callback: () => void) {
      observers.push({ fire: callback, observed: this.observed });
    }
    observe(element: Element) {
      this.observed.push(element);
    }
    unobserve() {}
    disconnect() {
      this.observed.length = 0;
    }
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  cleanups.push(() => vi.unstubAllGlobals());
  const fixture = mount([['A', 'B']], [100, 100]);
  const host = createNativeTableResizeHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  let bumps = 0;
  const release = host.registerLayout(() => bumps++);
  expect(observers.map((observer) => observer.observed)).toEqual([
    [fixture.root],
  ]);
  const cell = host.cellFromTarget(cellElement(fixture, 0));
  if (!cell) throw new Error('Missing hit');
  const first = host.beginDrag(cell, 'right', 1);
  first?.apply(10);
  await first?.settled();
  expect(bumps).toBeGreaterThan(0);
  const afterCommit = bumps;
  observers[0]?.fire();
  expect(bumps).toBe(afterCommit + 1);
  const seen = bumps;
  release();
  expect(observers[0]?.observed).toEqual([]);
  const second = host.beginDrag(cell, 'right', 1);
  second?.apply(20);
  await second?.settled();
  expect(bumps).toBe(seen);
});

// --- Move host (TableMoveHandle backend) ----------------------------------

test('move host: tracked cells follow a table selection, a caret cell, and clear outside', async () => {
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
  expect(tracked && [tracked.anchor?.index, tracked.focus?.index]).toEqual([
    a,
    d,
  ]);
  expect(tracked?.merged).toBe(false);
  expect(tracked && host.shape(tracked)).toEqual({ rows: 2, columns: 2 });
  caretIn(fixture, d);
  const caret = host.trackedCells();
  expect(caret && [caret.anchor?.index, caret.focus?.index]).toEqual([d, d]);
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

test('move host: dragging the handle moves the range onto the dropped cell', async () => {
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
  const probe = await host.move(tracked, cellElement(fixture, 3));
  if (probe.kind === 'failed')
    console.log(
      'PROBE',
      String(probe.error),
      probe.error instanceof Error
        ? probe.error.stack?.split('\n').slice(0, 6).join(' | ')
        : ''
    );
  expect(probe).toMatchObject({
    kind: 'settled',
    published: true,
  });
  expect(rowTexts(fixture)).toEqual([
    ['', 'B'],
    ['C', 'A'],
  ]);
});

test('move host: a desktop tap selects the tracked cells as a table selection', async () => {
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
  await host.selectCells(tracked);
  expect(fixture.view.selection().selection).toEqual({
    kind: 'table',
    table: tableKey(fixture),
    anchorCell: a,
    focusCell: a,
  });
});

// --- Gap (e): touch menu actions use the live selection (Source runMenuAction)

test('(e) characterization: native insert-row under a two-row table selection inserts after the given cell', async () => {
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

test('(e) touch menu "Insert row below" under a two-row table selection inserts below the selection, as Source', async () => {
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
  await host.menuAction('insert-row-below', host.trackedCells());
  expect(rowTexts(fixture)).toEqual([['A'], ['B'], [''], ['C']]);
});

test('(e) touch menu "Insert row above" under a backward two-row selection inserts above the upper row, as Source', async () => {
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
  await host.menuAction('insert-row-above', host.trackedCells());
  expect(rowTexts(fixture)).toEqual([['A'], [''], ['B'], ['C']]);
});

test('(e) touch menu "Delete row" under a table selection deletes every covered row, as Source', async () => {
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
  await host.menuAction('delete-row', host.trackedCells());
  expect(rowTexts(fixture)).toEqual([['C']]);
});

test('(e) touch menu with the live selection outside the table acts on the tracked anchor cell only', async () => {
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
  await host.menuAction('delete-row', tracked);
  expect(rowTexts(fixture)).toEqual([['A'], ['C']]);
});

test('(e) touch menu "Delete table" removes the whole table', async () => {
  const fixture = mount([['A'], ['B']]);
  const host = createNativeTableMoveHost(fixture.view, () => true);
  cleanups.push(() => host.dispose());
  const [a] = cellKeys(fixture);
  if (a === undefined) throw new Error('Missing cells');
  caretIn(fixture, a);
  await host.menuAction('delete-table', host.trackedCells());
  expect(fixture.root.querySelector('table')).toBeNull();
});
