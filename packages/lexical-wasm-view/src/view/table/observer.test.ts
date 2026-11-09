/** @vitest-environment jsdom */
import {
  CommandCode,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { beforeAll, expect, test, vi } from 'vitest';
import { selectionMessage } from '../session-port';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '../test/native-surface';
import { getTableObserverFromTableElement, sameCarry } from './observer';

beforeAll(initializeNativeSurfaceTests);

test.each([8, 256])(
  'native table edits touch one row among %i rows',
  (size) => {
    const fixture = nativeSurface();
    try {
      fixture.port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'table',
                version: 1,
                children: Array.from({ length: size }, (_, y) => ({
                  type: 'tablerow',
                  version: 1,
                  children: Array.from({ length: y === 1 ? 1 : 2 }, (_, x) => ({
                    type: 'tablecell',
                    version: 1,
                    colSpan: 1,
                    rowSpan: y === 0 && x === 0 ? 2 : 1,
                    headerState: 0,
                    children: [
                      {
                        type: 'paragraph',
                        version: 1,
                        children: [
                          { type: 'text', version: 1, text: `cell ${y} ${x}` },
                        ],
                      },
                    ],
                  })),
                })),
              },
            ],
          },
        })
      );
      const table = fixture.root.querySelector('table');
      if (!table) throw new Error('Missing native table');
      const observer = getTableObserverFromTableElement(table);
      if (!observer) throw new Error('Missing native observer');
      const grid = observer.getGrid();
      expect(grid[0][0]).toBe(grid[1][0]);
      observer.select(grid[0][0].key, grid[1][1].key);
      expect(
        table.querySelectorAll('[data-lexical-table-selected]')
      ).toHaveLength(3);
      const reads = vi.spyOn(Map.prototype, 'get');
      const beforeReads = reads.mock.calls.length;
      for (let i = 0; i < 1000; i++) observer.getGrid();
      const queryReads = reads.mock.calls.length - beforeReads;
      reads.mockRestore();
      expect(queryReads).toBe(0);
      const last = grid[size - 1][0];
      const text = [...fixture.view.mirror.values()].find(
        (node) => node.text === `cell ${size - 1} 0`
      );
      const row = fixture.view.node(last.key)?.parent;
      if (!text || row == null) throw new Error('Missing dirty row');
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key: text.key, type: 'text', offset: 2 },
        focus: { key: text.key, type: 'text', offset: 2 },
      });
      const lookups = vi.spyOn(fixture.view, 'node');
      const attributes = vi.spyOn(Element.prototype, 'setAttribute');
      try {
        // A real native paragraph property commit inside a cell does no grid work.
        fixture.port.command(CommandCode.FormatElement, 2);
        expect(lookups.mock.calls.length).toBeLessThan(40);
        lookups.mockClear();
        attributes.mockClear();
        observer.refresh(new Set([row]));
        expect(lookups.mock.calls.length).toBeLessThan(10);
        expect(attributes.mock.calls).toHaveLength(0);
        observer.select(grid[0][0].key, grid[1][1].key);
        expect(attributes.mock.calls).toHaveLength(0);
        observer.clear();
        expect(attributes.mock.calls).toHaveLength(3);
      } finally {
        lookups.mockRestore();
        attributes.mockRestore();
      }
      expect(observer.getGrid()[1][0].key).toBe(grid[0][0].key);
      const generation = fixture.view.mirror.keyGeneration;
      if (generation === null) throw new Error('Missing generation');
      const appendAttributes = vi.spyOn(Element.prototype, 'setAttribute');
      try {
        fixture.port.input(
          EditorInputMsg.fromEditorApplication({
            name: 'group-b.table',
            json: JSON.stringify({
              action: 'insert-row',
              cell: last.key,
              after: true,
            }),
            generation,
            selection: selectionMessage({ kind: 'keep' }),
            keyboard: false,
            key: '',
            mods: 0,
            code: 0,
          })
        );
        const writes = appendAttributes.mock.instances.filter(
          (element) => element instanceof HTMLTableCellElement
        ).length;
        expect(writes).toBeLessThan(20);
      } finally {
        appendAttributes.mockRestore();
      }
      expect(observer.getGrid()).toHaveLength(size + 1);
      expect(observer.getGrid()[0][0].element).toBe(grid[0][0].element);
    } finally {
      fixture.close();
    }
  }
);

test('a new rowspan carry in a sparse column cannot stop row propagation', () => {
  const first = {
    element: document.createElement('td'),
    key: 10,
    x: 0,
    y: 0,
    colSpan: 1,
    rowSpan: 2,
  };
  const last = {
    element: document.createElement('td'),
    key: 30,
    x: 2,
    y: 0,
    colSpan: 1,
    rowSpan: 2,
  };
  const before: ({ cell: typeof first; remaining: number } | undefined)[] = [];
  before[2] = { cell: last, remaining: 1 };
  const after = [
    { cell: first, remaining: 1 },
    undefined,
    { cell: last, remaining: 1 },
  ];
  expect(sameCarry(before, after)).toBe(false);
  expect(sameCarry(after, before)).toBe(false);
});

test('native table DOM replacement restores cached selection without a selection change', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'table',
              version: 1,
              children: [
                {
                  type: 'tablerow',
                  version: 1,
                  children: [0, 1].map((i) => ({
                    type: 'tablecell',
                    version: 1,
                    colSpan: 1,
                    rowSpan: 1,
                    headerState: 0,
                    children: [
                      {
                        type: 'paragraph',
                        version: 1,
                        children: [
                          { type: 'text', version: 1, text: String(i) },
                        ],
                      },
                    ],
                  })),
                },
              ],
            },
          ],
        },
      })
    );
    const previous = fixture.root.querySelector('table');
    if (!previous) throw new Error('Missing native table');
    const observer = getTableObserverFromTableElement(previous);
    if (!observer) throw new Error('Missing native observer');
    const grid = observer.getGrid();
    const tableKey = fixture.view.keyFromDOM(previous);
    const generation = fixture.view.mirror.keyGeneration;
    if (tableKey === null || generation === null)
      throw new Error('Missing native table identity');
    fixture.port.selectionFromView({
      kind: 'table',
      table: tableKey,
      anchorCell: grid[0][0].key,
      focusCell: grid[0][1].key,
    });
    expect(
      previous.querySelectorAll('[data-lexical-table-selected]')
    ).toHaveLength(2);
    const tableChildren = fixture.view.node(tableKey)?.children;
    const renderer = fixture.view.registry.get('table');
    fixture.view.registry.replace('table', {
      ...renderer,
      updateDOM: () => true,
    });
    fixture.port.input(
      EditorInputMsg.fromEditorApplication({
        name: 'group-b.table',
        json: JSON.stringify({
          action: 'restore-columns',
          table: tableKey,
          widths: [120, 180],
        }),
        generation,
        selection: selectionMessage({ kind: 'keep' }),
        keyboard: false,
        key: '',
        mods: 0,
        code: 0,
      })
    );
    expect(fixture.view.node(tableKey)?.children).toBe(tableChildren);
    const next = fixture.root.querySelector('table');
    expect(next).not.toBe(previous);
    if (!next) throw new Error('Missing replacement table');
    expect(getTableObserverFromTableElement(previous)).toBeNull();
    expect(next.querySelectorAll('[data-lexical-table-selected]')).toHaveLength(
      2
    );
    expect(next.querySelectorAll('[aria-selected="true"]')).toHaveLength(2);
    expect(
      getTableObserverFromTableElement(next)?.getGrid()[0][0].element
    ).toBe(grid[0][0].element);
  } finally {
    fixture.close();
  }
});

test('native trailing row deletion retains spanning virtual rows and updates prefix cells', () => {
  const fixture = nativeSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'table',
              version: 1,
              children: [
                {
                  type: 'tablerow',
                  version: 1,
                  children: [0, 1].map((i) => ({
                    type: 'tablecell',
                    version: 1,
                    colSpan: 1,
                    rowSpan: i === 0 ? 3 : 1,
                    headerState: 0,
                    children: [
                      {
                        type: 'paragraph',
                        version: 1,
                        children: [
                          { type: 'text', version: 1, text: `first ${i}` },
                        ],
                      },
                    ],
                  })),
                },
                {
                  type: 'tablerow',
                  version: 1,
                  children: [
                    {
                      type: 'tablecell',
                      version: 1,
                      colSpan: 1,
                      rowSpan: 1,
                      headerState: 0,
                      children: [
                        {
                          type: 'paragraph',
                          version: 1,
                          children: [
                            { type: 'text', version: 1, text: 'last' },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    );
    const table = fixture.root.querySelector('table');
    if (!table) throw new Error('Missing native table');
    const observer = getTableObserverFromTableElement(table);
    if (!observer) throw new Error('Missing native observer');
    const grid = observer.getGrid();
    expect(grid).toHaveLength(3);
    expect(grid[2][0]).toBe(grid[0][0]);
    const generation = fixture.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing generation');
    fixture.port.input(
      EditorInputMsg.fromEditorApplication({
        name: 'group-b.table',
        json: JSON.stringify({
          action: 'delete',
          cell: grid[1][1].key,
          axis: 'row',
        }),
        generation,
        selection: selectionMessage({ kind: 'keep' }),
        keyboard: false,
        key: '',
        mods: 0,
        code: 0,
      })
    );
    expect(table.rows).toHaveLength(1);
    const next = observer.getGrid();
    expect(next).toHaveLength(2);
    expect(next[0][0].rowSpan).toBe(2);
    expect(next[1][0]).toBe(next[0][0]);
  } finally {
    fixture.close();
  }
});
