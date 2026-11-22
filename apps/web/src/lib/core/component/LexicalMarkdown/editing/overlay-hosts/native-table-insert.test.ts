/** @vitest-environment jsdom */
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test, vi } from 'vitest';
import { createNativeTableHoverHost } from './native-table-hover';

beforeAll(initializeNativeSurfaceTests);
function fixture() {
  const native = nativeSurface();
  native.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        children: [
          {
            type: 'table',
            children: [
              {
                type: 'tablerow',
                children: [
                  {
                    type: 'tablecell',
                    rowSpan: 2,
                    children: [{ type: 'paragraph', children: [] }],
                  },
                  {
                    type: 'tablecell',
                    colSpan: 2,
                    children: [{ type: 'paragraph', children: [] }],
                  },
                ],
              },
              {
                type: 'tablerow',
                children: [
                  {
                    type: 'tablecell',
                    children: [{ type: 'paragraph', children: [] }],
                  },
                  {
                    type: 'tablecell',
                    children: [{ type: 'paragraph', children: [] }],
                  },
                ],
              },
              {
                type: 'tablerow',
                children: [
                  {
                    type: 'tablecell',
                    children: [{ type: 'paragraph', children: [] }],
                  },
                  {
                    type: 'tablecell',
                    children: [{ type: 'paragraph', children: [] }],
                  },
                  {
                    type: 'tablecell',
                    children: [{ type: 'paragraph', children: [] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    })
  );
  return native;
}

test('native insertion reference uses the actual span map for leading borders', () => {
  const native = fixture();
  const resource = createNativeTableHoverHost(native.view, () => true);
  try {
    const rows = native.root.querySelectorAll('tr');
    const lower = rows[1].querySelector('td');
    if (!lower) throw new Error('Missing actual lower cell');
    const hit = resource.insertHost.cellFromTarget(lower);
    if (!hit) throw new Error('Missing actual cell hit');
    const topRight = rows[0].querySelectorAll('td')[1];
    const anchor = rows[0].querySelector('td');
    if (!topRight || !anchor) throw new Error('Missing actual top cells');
    expect(
      resource.insertHost.referenceForBorder(hit, 'row', 'start')?.key.index
    ).toBe(native.view.keyFromDOM(topRight));
    expect(
      resource.insertHost.referenceForBorder(hit, 'column', 'start')?.key.index
    ).toBe(native.view.keyFromDOM(anchor));
    const first = resource.insertHost.cellFromTarget(anchor);
    if (!first) throw new Error('Missing first cell');
    expect(
      resource.insertHost.referenceForBorder(first, 'row', 'start')
    ).toBeUndefined();
    expect(
      resource.insertHost.referenceForBorder(first, 'column', 'start')
    ).toBeUndefined();
    expect(
      resource.insertHost.referenceForBorder(hit, 'column', 'end')?.key
    ).toEqual(hit.key);
  } finally {
    resource.dispose();
    native.close();
  }
});

test('native insertion invokes the real row action and rejects a retired generation', () => {
  const native = fixture();
  const resource = createNativeTableHoverHost(native.view, () => true);
  try {
    const cell = native.root.querySelector('td');
    const hit = resource.insertHost.cellFromTarget(cell);
    if (!hit) throw new Error('Missing actual cell');
    const before = native.root.querySelectorAll('tr').length;
    resource.insertHost.insertAfter(hit.key, 'row');
    expect(native.root.querySelectorAll('tr')).toHaveLength(before + 1);
    native.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: 'replacement' }],
            },
          ],
        },
      })
    );
    const state = native.session.serializedState();
    resource.insertHost.insertAfter(hit.key, 'column');
    expect(native.session.serializedState()).toBe(state);
    expect(
      resource.insertHost.referenceForBorder(hit, 'row', 'end')
    ).toBeUndefined();
  } finally {
    resource.dispose();
    native.close();
  }
});

test('partial native insert root listener registration unwinds exactly once', () => {
  const native = fixture();
  const resource = createNativeTableHoverHost(native.view, () => true);
  const failure = { phase: 'insert-listener' };
  const add = native.root.addEventListener.bind(native.root);
  let count = 0;
  const spy = vi
    .spyOn(native.root, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      add(type, listener, options);
      if (type === 'pointermove') throw failure;
    });
  try {
    let rejected = false;
    try {
      resource.insertHost.registerRoot(() => count++);
    } catch (error) {
      expect(error).toBe(failure);
      rejected = true;
    }
    expect(rejected).toBe(true);
    native.root.dispatchEvent(new Event('pointermove'));
    expect(count).toBe(0);
    resource.dispose();
    resource.dispose();
  } finally {
    spy.mockRestore();
    resource.dispose();
    native.close();
  }
});

test('captured insertion keys cannot write after permission loss or disposal', () => {
  const native = fixture();
  let editable = true;
  const resource = createNativeTableHoverHost(native.view, () => editable);
  try {
    const hit = resource.insertHost.cellFromTarget(
      native.root.querySelector('td')
    );
    if (!hit) throw new Error('Missing actual cell');
    const state = native.session.serializedState();
    editable = false;
    resource.insertHost.insertAfter(hit.key, 'row');
    expect(native.session.serializedState()).toBe(state);
    editable = true;
    native.view.setEditable(false);
    resource.insertHost.insertAfter(hit.key, 'column');
    expect(native.session.serializedState()).toBe(state);
    native.view.setEditable(true);
    resource.dispose();
    resource.insertHost.insertAfter(hit.key, 'row');
    expect(native.session.serializedState()).toBe(state);
  } finally {
    resource.dispose();
    native.close();
  }
});

test('same-generation cell retirement cannot redirect insertion to another cell', async () => {
  const { deleteNativeTableAtHover } = await import(
    '../../plugins/tables/native'
  );
  const native = fixture();
  const resource = createNativeTableHoverHost(native.view, () => true);
  try {
    const hit = resource.insertHost.cellFromTarget(
      native.root.querySelector('td')
    );
    if (!hit) throw new Error('Missing actual cell');
    deleteNativeTableAtHover(native.view, hit.key.index, 'table');
    expect(native.view.mirror.keyGeneration).toBe(hit.key.generation);
    const state = native.session.serializedState();
    resource.insertHost.insertAfter(hit.key, 'row');
    expect(native.session.serializedState()).toBe(state);
    expect(native.root.querySelectorAll('table')).toHaveLength(0);
  } finally {
    resource.dispose();
    native.close();
  }
});

test('hover delete uses current selection bounds for a merged table', () => {
  const native = fixture();
  const resource = createNativeTableHoverHost(native.view, () => true);
  try {
    const table = native.root.querySelector('table');
    const rows = native.root.querySelectorAll('tr');
    const first = rows[0].querySelector('td');
    const next = rows[1].querySelector('td');
    if (!table || !first || !next) throw new Error('Missing actual table');
    const tableKey = native.view.keyFromDOM(table);
    const anchor = resource.deleteHost.cellFromTarget(first);
    const focus = resource.deleteHost.cellFromTarget(next);
    if (tableKey === null || !anchor || !focus)
      throw new Error('Missing native cell keys');
    native.port.selectionFromView({
      kind: 'table',
      table: tableKey,
      anchorCell: anchor.key.index,
      focusCell: focus.key.index,
    });
    const before = native.session.serializedState();
    expect(
      resource.deleteHost.selectionPixels(anchor, first.getBoundingClientRect())
    ).toMatchObject({
      selectedRowCount: 2,
      selectedColumnCount: 2,
    });
    expect(native.session.serializedState()).toBe(before);
    native.port.selectionFromView({ kind: 'none' });
    expect(
      resource.deleteHost.selectionPixels(anchor, first.getBoundingClientRect())
    ).toMatchObject({
      selectedRowCount: 1,
      selectedColumnCount: 1,
    });
  } finally {
    resource.dispose();
    native.close();
  }
});
