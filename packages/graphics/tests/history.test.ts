import { expect, it } from 'vitest';
import { translation } from '../src/core/affine';
import { nudgeCommand } from '../src/core/commands';
import { createGraphicsEditor } from '../src/core/editor';
import {
  applyDocumentDelta,
  type DocumentDelta,
  documentDelta,
} from '../src/core/history';
import type {
  GraphicsItem,
  PencilItem,
  RectangleItem,
} from '../src/core/model';
import { sortKeysBetween } from '../src/core/ordering';
import { createScene, freezeDocument } from '../src/core/scene';

function rectangle(id = 'a', sortKey = 'a0'): RectangleItem {
  return {
    id,
    type: 'rectangle',
    placement: { parentId: 'scene-root', sortKey },
    transform: translation(0, 0),
    geometry: { width: 20, height: 20 },
    appearance: { fill: 'red', stroke: 'black' },
  };
}

it('shares untouched items and pencil samples through local edits, undo and redo', () => {
  const pencil: PencilItem = {
    ...rectangle('ink', 'a1'),
    type: 'pencil',
    geometry: {
      simulatePressure: false,
      points: Array.from({ length: 1000 }, (_, i) => [i, i % 10, 0.5]),
    },
  };
  const editor = createGraphicsEditor([rectangle(), pencil]);
  const original = editor.document.items.ink as PencilItem;
  const untouched = editor.document.items.a;
  editor.select('ink');
  editor.execute(nudgeCommand, { x: 10, y: 5 });
  const moved = editor.document.items.ink as PencilItem;
  expect(moved).not.toBe(original);
  expect(moved.geometry).toBe(original.geometry);
  expect(moved.geometry.points).toBe(original.geometry.points);
  expect(editor.document.items.a).toBe(untouched);
  editor.undo();
  expect(editor.document.items.ink).toBe(original);
  expect(editor.document.items.a).toBe(untouched);
  editor.redo();
  expect(editor.document.items.ink).toBe(moved);
  expect(editor.document.items.a).toBe(untouched);
  editor.dispose();
});

it('retains 500 changed-item pairs for 100 edits of five out of 1000 items', () => {
  const keys = sortKeysBetween(null, null, 1000);
  const editor = createGraphicsEditor(
    keys.map((key, i) => rectangle(`r${i}`, key))
  );
  for (let i = 0; i < 5; i++) editor.toggleSelection(`r${i}`);
  const entries: DocumentDelta[] = [];
  for (let i = 0; i < 100; i++) {
    const before = editor.document;
    editor.execute(nudgeCommand, { x: 1, y: 0 });
    const delta = documentDelta(before, editor.document)!;
    expect(delta.items).toHaveLength(5);
    entries.push(delta);
  }
  const retained = new Set(Object.values(editor.document.items));
  for (const entry of entries) {
    for (const change of entry.items) {
      if (change.before) retained.add(change.before);
      if (change.after) retained.add(change.after);
    }
  }
  // 1000 live shapes + 500 previous versions + the single surface root.
  expect(retained.size).toBe(1501);
  const geometries = new Set(
    [...retained].flatMap((item) => ('geometry' in item ? [item.geometry] : []))
  );
  expect(geometries.size).toBe(1000);
  for (let i = 0; i < 100; i++) editor.undo();
  expect((editor.document.items.r0 as RectangleItem).transform[4]).toBe(0);
  expect(editor.getSession().canUndo).toBe(false);
  for (let i = 0; i < 100; i++) editor.redo();
  expect((editor.document.items.r0 as RectangleItem).transform[4]).toBe(100);
  expect(editor.getSession().canRedo).toBe(false);
  editor.dispose();
});

it('keeps the 100-step limit and preserves redo across an unchanged proposal', () => {
  const editor = createGraphicsEditor([rectangle()]);
  editor.select('a');
  for (let i = 0; i < 105; i++) editor.execute(nudgeCommand, { x: 1, y: 0 });
  for (let i = 0; i < 100; i++) editor.undo();
  expect((editor.document.items.a as RectangleItem).transform[4]).toBe(5);
  expect(editor.getSession().canUndo).toBe(false);
  editor.execute(
    {
      id: 'same-items',
      apply: ({ document }) => ({ document: { ...document } }),
    },
    undefined
  );
  expect(editor.getSession().canRedo).toBe(true);
  editor.redo();
  expect((editor.document.items.a as RectangleItem).transform[4]).toBe(6);
  editor.execute(nudgeCommand, { x: 10, y: 0 });
  expect(editor.getSession().canRedo).toBe(false);
  editor.dispose();
});

it('reverses creation, deletion, root and surface changes in one transaction', () => {
  const before = createScene([rectangle('__proto__')]);
  const after = freezeDocument({
    rootId: 'other-root',
    items: {
      'other-root': { id: 'other-root', type: 'surface' },
      b: {
        ...rectangle('b'),
        placement: { parentId: 'other-root', sortKey: 'a0' },
      },
    },
    surface: { id: 'image', width: 100, height: 200 },
  });
  const delta = documentDelta(before, after)!;
  const undone = applyDocumentDelta(after, delta, 'before');
  expect(undone).toEqual(before);
  expect(
    Object.getOwnPropertyDescriptor(undone.items, '__proto__')?.value
  ).toBe(Object.getOwnPropertyDescriptor(before.items, '__proto__')?.value);
  expect(Object.isFrozen(undone.items)).toBe(true);
  expect(Object.hasOwn(undone, 'surface')).toBe(false);
  const redone = applyDocumentDelta(undone, delta, 'after');
  expect(redone).toEqual(after);
  expect(redone.items.b).toBe(after.items.b);
});

it('does not trust shallow-frozen external data or freeze caller-owned geometry', () => {
  const points: [number, number, number][] = [
    [0, 0, 0.5],
    [1, 1, 0.5],
  ];
  const input: PencilItem = Object.freeze({
    ...rectangle(),
    type: 'pencil',
    geometry: Object.freeze({ points, simulatePressure: false }),
  });
  const document = createScene([input]);
  const stored = document.items.a as PencilItem;
  points[0]![0] = 999;
  expect(stored.geometry.points[0]![0]).toBe(0);
  expect(Object.isFrozen(points)).toBe(false);
  expect(freezeDocument(document)).toBe(document);
});

it('revalidates document-wide invariants when reusing already frozen items', () => {
  const document = createScene([
    {
      id: 'group',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
    },
    { ...rectangle(), placement: { parentId: 'group', sortKey: 'a0' } },
  ]);
  const items: Record<string, GraphicsItem> = { ...document.items };
  delete items.group;
  expect(() => freezeDocument({ ...document, items })).toThrow(
    'Invalid parent'
  );
});
