/** @vitest-environment jsdom */

import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { tableEditPublished } from './native-table-edit';
import { createNativeTableSelectionActionsHost } from './native-table-selection-actions';
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

function selectCells(fixture: Fixture, anchor: number, focus: number) {
  fixture.port.selectionFromView({
    kind: 'table',
    table: tableKey(fixture),
    anchorCell: anchor,
    focusCell: focus,
  });
}

test('tracks the table selection corners and hides for a caret', () => {
  const fixture = mount([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  const host = createNativeTableSelectionActionsHost(fixture.view, () => true);
  const [a, b, , d] = cellKeys(fixture);
  if (a === undefined || b === undefined || d === undefined)
    throw new Error('Missing cells');
  selectCells(fixture, a, d);
  expect(host.tracked()).toEqual({ anchor: a, focus: d, merged: false });
  expect(host.elementFor(a)?.textContent).toBe('A');
  expect(host.clipboardData()?.['text/plain']).toContain('A');
  caretIn(fixture, b);
  expect(host.tracked()).toBeUndefined();
  expect(host.clipboardData()).toBeNull();
});

test('merge joins the selected cells and clears the selection; split restores the grid', async () => {
  const fixture = mount([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  const host = createNativeTableSelectionActionsHost(fixture.view, () => true);
  const [a, b] = cellKeys(fixture);
  if (a === undefined || b === undefined) throw new Error('Missing cells');
  selectCells(fixture, a, b);
  expect(tableEditPublished(await host.merge())).toBe(true);
  expect(rowTexts(fixture)).toEqual([['AB'], ['C', 'D']]);
  expect(fixture.view.selection().selection.kind).toBe('none');
  const [merged] = cellKeys(fixture);
  if (merged === undefined) throw new Error('Missing merged cell');
  selectCells(fixture, merged, merged);
  expect(host.tracked()?.merged).toBe(true);
  expect(tableEditPublished(await host.split())).toBe(true);
  expect(rowTexts(fixture)).toEqual([
    ['AB', ''],
    ['C', 'D'],
  ]);
  expect(fixture.view.selection().selection.kind).toBe('none');
});

test('without edit access merge and split send nothing', async () => {
  const fixture = mount([
    ['A', 'B'],
    ['C', 'D'],
  ]);
  const host = createNativeTableSelectionActionsHost(fixture.view, () => false);
  const [a, b] = cellKeys(fixture);
  if (a === undefined || b === undefined) throw new Error('Missing cells');
  selectCells(fixture, a, b);
  expect(await host.merge()).toEqual({ kind: 'refused' });
  expect(await host.split()).toEqual({ kind: 'refused' });
  expect(rowTexts(fixture)).toEqual([
    ['A', 'B'],
    ['C', 'D'],
  ]);
});
