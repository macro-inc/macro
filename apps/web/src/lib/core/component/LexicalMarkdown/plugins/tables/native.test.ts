/** @vitest-environment jsdom */
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { beforeAll, expect, test } from 'vitest';
import { queryApplication } from '../group-b/command';
import { deleteNativeTableAtHover } from './native';

beforeAll(initializeNativeSurfaceTests);

test('hover deletion keeps the native table range when the DOM still holds a stale caret', () => {
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
                ['A', 'B'],
                ['C', 'D'],
              ].map((cells) => ({
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
    const table = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'table'
    );
    const cells = [...fixture.view.mirror.values()].filter(
      (node) => node.type === 'tablecell'
    );
    const first = cells.at(0);
    const last = cells.at(-1);
    const text = fixture.root.querySelector('td span')?.firstChild;
    if (!table || !first || !last || !text)
      throw new Error('Missing table fixture');
    fixture.root.focus();
    fixture.port.selectionFromView({
      kind: 'table',
      table: table.key,
      anchorCell: first.key,
      focusCell: last.key,
    });
    expect(fixture.view.selection().selection).toEqual({
      kind: 'table',
      table: table.key,
      anchorCell: first.key,
      focusCell: last.key,
    });
    // A rejected table endpoint must return the authoritative previous selection.
    fixture.port.selectionFromView({
      kind: 'table',
      table: table.key,
      anchorCell: 0,
      focusCell: last.key,
    });
    expect(fixture.view.selection().selection).toEqual({
      kind: 'table',
      table: table.key,
      anchorCell: first.key,
      focusCell: last.key,
    });
    document.getSelection()?.setBaseAndExtent(text, 0, text, 0);
    fixture.counters.admissions = 0;
    fixture.session.query = () => {
      throw new Error('Per-cell query on table command');
    };
    fixture.session.nodeText = () => {
      throw new Error('Per-node query on table command');
    };
    expect(deleteNativeTableAtHover(fixture.view, last.key, 'row')).toBe(true);
    expect(fixture.root.querySelector('table')).toBeNull();
    expect(fixture.counters.admissions).toBe(1);
  } finally {
    fixture.close();
  }
});

test('bulk resize reads reject retired generations and unknown namespaces without document changes', () => {
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
                  children: [
                    {
                      type: 'tablecell',
                      version: 1,
                      children: [
                        { type: 'paragraph', version: 1, children: [] },
                      ],
                    },
                    {
                      type: 'tablecell',
                      version: 1,
                      children: [
                        { type: 'paragraph', version: 1, children: [] },
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
    const table = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'table'
    );
    const cell = [...fixture.view.mirror.values()].find(
      (node) => node.type === 'tablecell'
    );
    const generation = fixture.view.mirror.keyGeneration;
    if (!table || !cell || generation === null)
      throw new Error('Missing table fixture');
    const before = fixture.port.query({
      kind: 7,
      key: 0,
      flags: 0,
      text: '',
    }).text;
    expect(
      queryApplication(fixture.view, 'group-b.table-resize', {
        cell: cell.key,
        edge: 'right',
        zoom: 1,
        measurements: [],
      })
    ).toEqual({
      axis: 'column',
      generation,
      table: table.key,
      column: 0,
      baseWidths: [120, 120],
      revertWidths: [120, 120],
    });
    expect(() =>
      fixture.port.query({
        kind: 9,
        key: 0,
        flags: generation + 1,
        text: JSON.stringify({ name: 'group-b.table-resize', data: {} }),
      })
    ).toThrow('application query generation');
    expect(() => queryApplication(fixture.view, 'unknown.query', {})).toThrow(
      'application query'
    );
    expect(
      fixture.port.query({ kind: 7, key: 0, flags: 0, text: '' }).text
    ).toBe(before);
  } finally {
    fixture.close();
  }
});
