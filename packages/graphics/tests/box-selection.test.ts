import { expect, it } from 'vitest';
import { attachCameraControls } from '../src/browser';
import { createGraphicsEditor } from '../src/core';
import { translation } from '../src/core/affine';
import { drawableIds, worldBounds } from '../src/core/scene';

const makeEditor = () =>
  createGraphicsEditor(
    ['a', 'b', 'c'].map((id, i) => ({
      id,
      type: 'rectangle' as const,
      placement: { parentId: 'scene-root', sortKey: `a${i}` },
      transform: translation(i * 100, 0),
      geometry: { width: 50, height: 50 },
      appearance: { fill: 'white', stroke: 'black' },
    }))
  );

it('selects touched items in either drag direction, adds with Shift semantics and cancels to the prior selection', () => {
  const editor = makeEditor();
  editor.beginBoxSelection({ x: 110, y: 20 });
  editor.updateBoxSelection({ x: -10, y: -10 });
  expect(editor.getSession().selectedIds).toEqual(['a', 'b']);
  editor.commitBoxSelection();
  expect(editor.getSession().canUndo).toBe(false);
  editor.toggleSelection('a');
  expect(editor.getSession().selectedIds).toEqual(['b']);
  editor.beginBoxSelection({ x: 220, y: 20 }, true);
  editor.updateBoxSelection({ x: 210, y: 10 });
  expect(editor.getSession().selectedIds).toEqual(['b', 'c']);
  editor.cancelTransform();
  expect(editor.getSession().selectedIds).toEqual(['b']);
  editor.beginBoxSelection({ x: -10, y: -10 }, true);
  editor.updateBoxSelection({ x: 20, y: 20 });
  editor.commitBoxSelection();
  expect(editor.getSession().selectedIds).toEqual(['b', 'a']);
  editor.beginBoxSelection({ x: 500, y: 500 });
  editor.commitBoxSelection();
  expect(editor.getSession().selectedIds).toEqual([]);
});

it('moves and deletes groups in single undo steps and cancels group previews', () => {
  const editor = makeEditor();
  editor.select('a');
  editor.toggleSelection('b');
  editor.beginTransform('a', { x: 0, y: 0 });
  editor.updateTransform({ x: 20, y: 30 });
  expect(editor.getSession().transform?.geometries.b?.x).toBe(120);
  expect(worldBounds(editor.document, 'b').x).toBe(100);
  editor.cancelTransform();
  expect(editor.getSession().canUndo).toBe(false);
  editor.beginTransform('b', { x: 100, y: 0 });
  editor.updateTransform({ x: 120, y: 30 });
  editor.commitTransform();
  expect(worldBounds(editor.document, 'a').x).toBe(20);
  expect(worldBounds(editor.document, 'b').x).toBe(120);
  editor.undo();
  expect(worldBounds(editor.document, 'a').x).toBe(0);
  expect(worldBounds(editor.document, 'b').x).toBe(100);
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  editor.deleteSelection();
  expect(drawableIds(editor.document)).toEqual(['c']);
  editor.undo();
  expect(drawableIds(editor.document)).toEqual(['a', 'b', 'c']);
});

it('routes Shift-click, Shift-box and Escape through pointer controls at non-default zoom', () => {
  const editor = makeEditor();
  editor.zoomAt({ x: 0, y: 0 }, 2);
  const viewport = document.createElement('div');
  document.body.append(viewport);
  let captured = false;
  viewport.setPointerCapture = () => {
    captured = true;
  };
  viewport.hasPointerCapture = () => captured;
  viewport.releasePointerCapture = () => {
    captured = false;
  };
  const a = document.createElement('div');
  a.dataset.graphicsItem = 'a';
  viewport.append(a);
  const detach = attachCameraControls(viewport, editor, {
    tool: () => 'select',
    editing: true,
  });
  const pointer = (
    type: string,
    x: number,
    y: number,
    shiftKey = false,
    target = viewport
  ) => {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      shiftKey,
      bubbles: true,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  pointer('pointerdown', 20, 20, true, a);
  pointer('pointerup', 20, 20, true, a);
  expect(editor.getSession().selectedIds).toEqual(['a']);
  pointer('pointerdown', 190, -10, true);
  pointer('pointermove', 210, 20, true);
  pointer('pointerup', 210, 20, true);
  expect(editor.getSession().selectedIds).toEqual(['a', 'b']);
  pointer('pointerdown', 390, -10);
  pointer('pointermove', 410, 20);
  expect(editor.getSession().selectedIds).toEqual(['c']);
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(editor.getSession().selectedIds).toEqual(['a', 'b']);
  expect(editor.getSession().box).toBeUndefined();
  expect(captured).toBe(false);
  detach();
  viewport.remove();
});
