import { expect, it } from 'vitest';
import { createGraphicsEditor } from '../src/core';
import { drawableIds, worldBounds } from '../src/core/scene';

function makeEditor() {
  return createGraphicsEditor([
    {
      id: 'a',
      type: 'rectangle',
      geometry: { x: 10, y: 20, width: 100, height: 80 },
      appearance: { fill: 'transparent', stroke: 'black' },
    },
  ]);
}

it('commits one history entry per gesture and keeps camera and selection out of history', () => {
  const editor = makeEditor();
  let changes = 0;
  editor.subscribeDocument(() => changes++);
  editor.beginTransform('a', { x: 30, y: 40 });
  editor.updateTransform({ x: 50, y: 60 });
  editor.updateTransform({ x: 80, y: 90 });
  expect(worldBounds(editor.document, 'a').x).toBe(10);
  expect(changes).toBe(0);
  editor.commitTransform();
  expect(changes).toBe(1);
  expect(worldBounds(editor.document, 'a')).toEqual({
    x: 60,
    y: 70,
    width: 100,
    height: 80,
  });
  editor.panBy({ x: 40, y: 30 });
  editor.select();
  editor.undo();
  expect(worldBounds(editor.document, 'a').x).toBe(10);
  expect(editor.getCamera().x).toBe(40);
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  expect(worldBounds(editor.document, 'a').x).toBe(60);
});

it('supports every resize corner, crossing the anchor, cancellation and no-op gestures', () => {
  for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
    const editor = makeEditor();
    const origin = {
      x: corner.endsWith('w') ? 10 : 110,
      y: corner.startsWith('n') ? 20 : 100,
    };
    editor.beginTransform('a', origin, corner);
    editor.updateTransform({ x: -30, y: -40 });
    editor.commitTransform();
    expect(worldBounds(editor.document, 'a').width).toBeGreaterThan(0);
    expect(worldBounds(editor.document, 'a').height).toBeGreaterThan(0);
    editor.undo();
    expect(worldBounds(editor.document, 'a')).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 80,
    });
  }
  const editor = makeEditor();
  editor.beginTransform('a', { x: 30, y: 40 });
  editor.updateTransform({ x: 90, y: 90 });
  editor.cancelTransform();
  expect(editor.getSession().canUndo).toBe(false);
  editor.beginTransform('a', { x: 30, y: 40 });
  expect(editor.commitTransform()).toBe(false);
  expect(editor.getSession().canUndo).toBe(false);
});

it('undoes creation and deletion and drops redo after a new edit', () => {
  const editor = makeEditor();
  editor.select('a');
  editor.deleteSelection();
  expect(drawableIds(editor.document)).toEqual([]);
  expect(editor.getSession().selectedId).toBeUndefined();
  editor.undo();
  expect(drawableIds(editor.document)).toEqual(['a']);
  editor.beginRectangle({ x: -50, y: -50 });
  editor.updateRectangle({ x: -10, y: -10 });
  editor.commitRectangle('b', { fill: 'white', stroke: 'black' });
  expect(editor.getSession().canRedo).toBe(false);
  editor.undo();
  expect(drawableIds(editor.document)).toEqual(['a']);
  editor.redo();
  expect(drawableIds(editor.document)).toEqual(['a', 'b']);
  editor.select('b');
  editor.undo();
  expect(editor.getSession().selectedId).toBeUndefined();
});

it('bounds image edits and resets history when the image changes', () => {
  const editor = createGraphicsEditor();
  editor.setImageSurface({ id: 'image', width: 200, height: 100 });
  editor.beginRectangle({ x: 10, y: 10 });
  editor.updateRectangle({ x: 60, y: 60 });
  editor.commitRectangle('a', { fill: 'white', stroke: 'black' });
  editor.beginTransform('a', { x: 20, y: 20 });
  editor.updateTransform({ x: 1000, y: 1000 });
  editor.commitTransform();
  expect(worldBounds(editor.document, 'a')).toEqual({
    x: 150,
    y: 50,
    width: 50,
    height: 50,
  });
  editor.setImageSurface({ id: 'next', width: 50, height: 50 });
  expect(editor.getSession()).toMatchObject({
    canUndo: false,
    canRedo: false,
    selectedId: undefined,
  });
});

it('does not resize or create history when a handle is clicked off-center', () => {
  const editor = makeEditor();
  editor.beginTransform('a', { x: 112, y: 103 }, 'se');
  editor.updateTransform({ x: 112, y: 103 });
  expect(editor.commitTransform()).toBe(false);
  expect(editor.getSession().canUndo).toBe(false);
});
