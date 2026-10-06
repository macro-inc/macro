import { afterEach, expect, it } from 'vitest';
import {
  alignCommand,
  children,
  copyFragment,
  createGraphicsEditor,
  createScene,
  distributeCommand,
  duplicateCommand,
  freezeDocument,
  isShape,
  multiply,
  nudgeCommand,
  parseFragment,
  pasteCommand,
  rotation,
  selectAllCommand,
  selectedShapeIds,
  translation,
  worldBounds,
  worldMatrix,
} from '../src/core';
import { createGraphicsPeerLab } from './helpers/peer-lab';

const seed = () =>
  createScene([
    {
      id: 'group',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: multiply(translation(100, 70), rotation(0.4)),
    },
    {
      id: 'inner',
      type: 'group',
      placement: { parentId: 'group', sortKey: 'a0' },
      transform: multiply(translation(10, 30), rotation(-0.2)),
    },
    {
      id: 'a',
      type: 'rectangle',
      placement: { parentId: 'inner', sortKey: 'a0' },
      transform: translation(20, 0),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'ellipse',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(300, 200),
      geometry: { width: 60, height: 40 },
      appearance: { fill: 'transparent', stroke: 'black' },
    },
    {
      id: 'c',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a2' },
      transform: translation(470, 150),
      geometry: { width: 80, height: 120 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
  ]);
const ids = () => {
  let n = 0;
  return () => `copy-${++n}`;
};
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

it('round-trips nested selection with new IDs, ordering and world pose in one undo step', () => {
  const editor = createGraphicsEditor(seed());
  editor.select('group');
  editor.toggleSelection('a');
  const fragment = parseFragment(
    JSON.stringify(
      copyFragment(editor.document, editor.getSession().selectedIds)
    )
  )!;
  expect(children(fragment.scene)).toEqual(['group']);
  editor.execute(pasteCommand, {
    fragment,
    createId: ids(),
    offset: { x: 25, y: -10 },
  });
  const selected = editor.getSession().selectedIds;
  const leaf = selectedShapeIds(editor.document, selected)[0]!;
  expect(selected).toEqual(['copy-1']);
  expect(children(editor.document, 'copy-1')).toEqual(['copy-2']);
  expect(children(editor.document, 'copy-2')).toEqual(['copy-3']);
  expect(worldMatrix(editor.document, leaf)).toEqual(
    multiply(translation(25, -10), worldMatrix(seed(), 'a'))
  );
  expect(children(editor.document)).toEqual(['group', 'b', 'c', 'copy-1']);
  editor.undo();
  expect(editor.document).toEqual(seed());
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  expect(editor.document.items[leaf]).toBeDefined();
});

it('copies a deeply selected child into a different scene without changing its world pose', () => {
  const editor = createGraphicsEditor();
  editor.execute(pasteCommand, {
    fragment: copyFragment(seed(), ['a'])!,
    createId: ids(),
    offset: { x: 0, y: 0 },
  });
  expect(worldMatrix(editor.document, 'copy-1')).toEqual(
    worldMatrix(seed(), 'a')
  );
});

it('duplicates a nested child in its parent, then nudges in world coordinates', () => {
  const editor = createGraphicsEditor(seed());
  editor.select('a');
  editor.execute(duplicateCommand, { createId: ids() });
  const copy = editor.document.items['copy-1'];
  expect(copy).toMatchObject({ placement: { parentId: 'inner' } });
  const before = worldBounds(editor.document, 'copy-1');
  editor.execute(nudgeCommand, { x: 10, y: -1 });
  const after = worldBounds(editor.document, 'copy-1');
  expect(after.x - before.x).toBeCloseTo(10);
  expect(after.y - before.y).toBeCloseTo(-1);
  editor.undo();
  expect(worldBounds(editor.document, 'copy-1')).toEqual(before);
});

it('previews Option-drag copies without committing, cancels cleanly, and commits once', () => {
  const editor = createGraphicsEditor(seed());
  editor.select('group');
  let updates = 0;
  editor.subscribeDocument(() => updates++);
  editor.beginTransform('group', { x: 0, y: 0 }, undefined, ids());
  editor.updateTransform({ x: 80, y: 50 });
  expect(editor.document).toEqual(seed());
  expect(
    editor.getSession().transform?.document?.items['copy-3']
  ).toBeDefined();
  editor.cancelTransform();
  expect(editor.getSession().selectedIds).toEqual(['group']);
  expect(editor.getSession().canUndo).toBe(false);
  expect(updates).toBe(0);
  editor.beginTransform('group', { x: 0, y: 0 }, undefined, ids());
  editor.commitTransform();
  expect(updates).toBe(0);
  editor.beginTransform('group', { x: 0, y: 0 }, undefined, ids());
  editor.updateTransform({ x: 80, y: 50 });
  editor.commitTransform();
  expect(updates).toBe(1);
  expect(editor.getSession().selectedIds).toEqual(['copy-1']);
  editor.undo();
  expect(editor.document).toEqual(seed());
  expect(editor.getSession().canUndo).toBe(false);
});

it('aligns world bounds and distributes equal gaps with endpoints fixed', () => {
  const editor = createGraphicsEditor(seed());
  editor.execute(selectAllCommand, undefined);
  editor.execute(alignCommand, 'top');
  const bounds = children(editor.document).map((id) =>
    worldBounds(editor.document, id)
  );
  bounds.forEach((b) => expect(b.y).toBeCloseTo(bounds[0]!.y));
  editor.undo();
  expect(editor.document).toEqual(seed());
  const first = worldBounds(editor.document, 'group'),
    last = worldBounds(editor.document, 'c');
  editor.execute(distributeCommand, 'horizontal');
  const middle = worldBounds(editor.document, 'b');
  expect(worldBounds(editor.document, 'group')).toEqual(first);
  expect(worldBounds(editor.document, 'c')).toEqual(last);
  expect(middle.x - first.x - first.width).toBeCloseTo(
    last.x - middle.x - middle.width
  );
});

it('styles group descendants once, preserves mixed values, and rejects invalid proposals atomically', () => {
  const editor = createGraphicsEditor(seed());
  editor.select('group');
  editor.toggleSelection('b');
  editor.setSelectionAppearance({
    strokeWidth: 12,
    opacity: 0.5,
    cornerRadius: 15,
  });
  for (const id of ['a', 'b'])
    expect(editor.document.items[id]).toMatchObject({
      appearance: { strokeWidth: 12, opacity: 0.5, cornerRadius: 15 },
    });
  expect(editor.document.items.a).toMatchObject({
    appearance: { fill: 'red' },
  });
  editor.undo();
  expect(editor.document).toEqual(seed());
  expect(() => editor.setSelectionAppearance({ opacity: 2 })).toThrow();
  expect(() =>
    editor.execute(duplicateCommand, { createId: () => 'a' })
  ).toThrow();
  expect(editor.document).toEqual(seed());
  expect(editor.getSession().canUndo).toBe(false);
});

it('rejects malformed, cyclic, unsupported and oversized clipboard data', () => {
  expect(parseFragment('hello')).toBeUndefined();
  expect(parseFragment('x'.repeat(2_000_001))).toBeUndefined();
  const fragment = copyFragment(seed(), ['group'])!;
  for (const change of [
    { type: 'script' },
    { transform: [1, 0, 0, 1, null, 0] },
    { appearance: { fill: 'red', stroke: 'black', opacity: 9 } },
    { placement: { parentId: 'a', sortKey: 'a0' } },
  ]) {
    const scene = {
      ...fragment.scene,
      items: {
        ...fragment.scene.items,
        a: { ...fragment.scene.items.a, ...change },
      },
    };
    expect(
      parseFragment(JSON.stringify({ ...fragment, scene }))
    ).toBeUndefined();
  }
});

it('round-trips A1/A2 edits through Loro and local undo preserves concurrent peer style', () => {
  const lab = createGraphicsPeerLab(seed());
  cleanups.push(lab.dispose);
  lab.setConnected(false);
  const a = lab.peers[0]!.editor,
    b = lab.peers[1]!.editor;
  a.select('group');
  a.execute(duplicateCommand, { createId: ids() });
  lab.syncNow();
  a.execute(nudgeCommand, { x: 10, y: 20 });
  a.reorderSelection('back');
  lab.syncNow();
  expect(a.document).toEqual(b.document);
  expect(() => freezeDocument(a.document)).not.toThrow();
  a.undo();
  a.undo();
  lab.syncNow();
  expect(a.document).toEqual(b.document);
  a.select('a');
  b.select('a');
  a.setSelectionAppearance({ strokeWidth: 9 });
  b.setSelectionAppearance({ opacity: 0.25 });
  lab.syncNow();
  a.undo();
  lab.syncNow();
  const item = a.document.items.a;
  expect(isShape(item) && item.appearance.opacity).toBe(0.25);
  expect(isShape(item) && item.appearance.strokeWidth).toBe(2);
  expect(a.document).toEqual(b.document);
});

it('picks painted thick outlines and rounded fills while respecting empty corners', () => {
  const editor = createGraphicsEditor(seed());
  editor.select('c');
  editor.setSelectionAppearance({
    fill: 'transparent',
    strokeWidth: 20,
    cornerRadius: 20,
  });
  expect(editor.hitTest({ x: 462, y: 210 }, true)).toBe('c');
  expect(editor.hitTest({ x: 510, y: 210 }, true)).toBeUndefined();
  expect(editor.hitTest({ x: 470, y: 150 }, true)).toBe('c'); // rounded border is within its 10px painted band
  editor.setSelectionAppearance({ fill: 'red', strokeWidth: 0 });
  expect(editor.hitTest({ x: 470, y: 150 }, true)).toBeUndefined();
  expect(editor.hitTest({ x: 490, y: 170 }, true)).toBe('c');
  editor.setSelectionAppearance({ opacity: 0 });
  expect(editor.hitTest({ x: 490, y: 170 }, true)).toBeUndefined();
});
