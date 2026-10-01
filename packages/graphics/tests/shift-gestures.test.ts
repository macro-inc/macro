import { afterEach, expect, it, vi } from 'vitest';
import { attachCameraControls } from '../src/browser';
import {
  createGraphicsEditor,
  multiply,
  rotation,
  scaling,
  translation,
  worldBounds,
} from '../src/core';

const appearance = { fill: 'red', stroke: 'black' };
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function input(tool: 'rectangle' | 'ellipse' | 'select') {
  const editor = createGraphicsEditor([
    {
      id: 'a',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 100, height: 80 },
      appearance,
    },
  ]);
  const viewport = document.createElement('div');
  viewport.tabIndex = 0;
  document.body.append(viewport);
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  const detach = attachCameraControls(viewport, editor, {
    tool: () => tool,
    duplicateOnAltDrag: true,
    createId: () => 'new',
    appearance: () => appearance,
  });
  cleanups.push(() => {
    detach();
    editor.dispose();
    viewport.remove();
  });
  function pointer(
    type: string,
    x: number,
    y: number,
    modifiers: MouseEventInit = {}
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      ...modifiers,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    viewport.dispatchEvent(event);
  }
  function shift(pressed: boolean) {
    viewport.dispatchEvent(
      new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
        key: 'Shift',
        shiftKey: pressed,
        bubbles: true,
      })
    );
  }
  return { editor, viewport, pointer, shift };
}

it.each(['rectangle', 'ellipse'] as const)(
  'creates a proportional %s in every drag direction without losing the unconstrained endpoint',
  (kind) => {
    for (const [dx, dy] of [
      [80, 30],
      [-80, 30],
      [80, -30],
      [-80, -30],
    ]) {
      const editor = createGraphicsEditor();
      editor.beginShape(kind, { x: 100, y: 100 });
      editor.updateShape(
        { x: 100 + dx!, y: 100 + dy! },
        { proportional: true }
      );
      expect(editor.getPreview()).toEqual({
        x: dx! < 0 ? 20 : 100,
        y: dy! < 0 ? 20 : 100,
        width: 80,
        height: 80,
      });
      editor.updateDrawing([], { proportional: false });
      expect(editor.getPreview()).toMatchObject({ width: 80, height: 30 });
      editor.updateDrawing([], { proportional: true });
      const before = editor.document;
      editor.commitShape('new', appearance);
      expect(editor.document.items.new).toMatchObject({
        type: kind,
        geometry: { width: 80, height: 80 },
      });
      editor.undo();
      expect(editor.document).toEqual(before);
      editor.dispose();
    }
  }
);

it('keeps constrained image annotations square and inside the surface', () => {
  const editor = createGraphicsEditor();
  editor.setImageSurface({ id: 'image', width: 200, height: 120 });
  editor.beginShape('rectangle', { x: 100, y: 100 });
  editor.updateShape({ x: 190, y: 110 }, { proportional: true });
  expect(editor.getPreview()).toEqual({
    x: 100,
    y: 100,
    width: 20,
    height: 20,
  });
  editor.cancelShape();
  editor.beginShape('ellipse', { x: 10, y: 100 });
  editor.updateShape({ x: -100, y: 0 }, { proportional: true });
  expect(editor.getPreview()).toEqual({ x: 0, y: 90, width: 10, height: 10 });
  editor.dispose();
});

it.each(['rectangle', 'ellipse'] as const)(
  'updates %s drawing on stationary Shift changes and final release',
  (tool) => {
    const { editor, pointer, shift } = input(tool);
    const before = editor.document;
    pointer('pointerdown', 150, 150, { shiftKey: true });
    pointer('pointermove', 230, 180, { shiftKey: true });
    expect(editor.getPreview()).toMatchObject({ width: 80, height: 80 });
    shift(false);
    expect(editor.getPreview()).toMatchObject({ width: 80, height: 30 });
    shift(true);
    expect(editor.getPreview()).toMatchObject({ width: 80, height: 80 });
    expect(editor.document).toBe(before);
    pointer('pointerup', 230, 180);
    expect(editor.document.items.new).toMatchObject({
      geometry: { width: 80, height: 30 },
    });
    editor.undo();
    expect(editor.document).toEqual(before);
  }
);

it.each(['child', 'group', 'multi'] as const)(
  'constrains a %s move along world axes through nested transforms',
  (selection) => {
    const editor = createGraphicsEditor([
      {
        id: 'g',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: multiply(rotation(0.6), scaling(2, 0.7)),
      },
      ...['a', 'b'].map((id, i) => ({
        id,
        type: 'rectangle' as const,
        placement: { parentId: 'g', sortKey: `a${i}` },
        transform: translation(100 * i, 30),
        geometry: { width: 50, height: 30 },
        appearance,
      })),
    ]);
    const target = selection === 'group' ? 'g' : 'a';
    editor.select(target);
    if (selection === 'multi') editor.toggleSelection('b');
    const before = editor.document;
    const initial = worldBounds(before, target);
    editor.beginTransform(target, { x: 10, y: 10 });
    editor.updateTransform({ x: 90, y: 40 }, { constrainAxis: true });
    const horizontal = worldBounds(
      before,
      target,
      editor.getSession().transform?.nodes
    );
    expect(horizontal.x - initial.x).toBeCloseTo(80);
    expect(horizontal.y).toBeCloseTo(initial.y);
    editor.updateTransform({ x: 90, y: 40 });
    expect(
      worldBounds(before, target, editor.getSession().transform?.nodes).y -
        initial.y
    ).toBeCloseTo(30);
    editor.updateTransform({ x: -10, y: -90 }, { constrainAxis: true });
    editor.commitTransform();
    expect(worldBounds(editor.document, target).x).toBeCloseTo(initial.x);
    expect(worldBounds(editor.document, target).y - initial.y).toBeCloseTo(
      -100
    );
    editor.undo();
    expect(editor.document).toEqual(before);
    editor.dispose();
  }
);

it('preserves Shift-click toggling while Shift-drag moves, with live modifier changes and one undo', () => {
  const { editor, pointer, shift } = input('select');
  pointer('pointerdown', 20, 20, { shiftKey: true });
  expect(editor.getSession().selectedIds).toEqual([]);
  pointer('pointerup', 21, 21, { shiftKey: true });
  expect(editor.getSession().selectedIds).toEqual(['a']);
  const before = editor.document;
  pointer('pointerdown', 20, 20, { shiftKey: true });
  pointer('pointermove', 70, 35, { shiftKey: true });
  expect(editor.getSession().selectedIds).toEqual(['a']);
  expect(editor.getSession().transform?.geometries.a).toMatchObject({
    x: 50,
    y: 0,
  });
  shift(false);
  expect(editor.getSession().transform?.geometries.a).toMatchObject({
    x: 50,
    y: 15,
  });
  shift(true);
  expect(editor.getSession().transform?.geometries.a).toMatchObject({
    x: 50,
    y: 0,
  });
  pointer('pointerup', 70, 35, { shiftKey: true });
  expect(worldBounds(editor.document, 'a')).toMatchObject({ x: 50, y: 0 });
  editor.undo();
  expect(editor.document).toEqual(before);
  pointer('pointerdown', 20, 20, { shiftKey: true });
  pointer('pointerup', 20, 20, { shiftKey: true });
  expect(editor.getSession().selectedIds).toEqual([]);
});

it('constrains Option-Shift duplicates and cancels a pending Shift gesture without changing selection', () => {
  const { editor, viewport, pointer } = input('select');
  editor.select('a');
  const before = editor.document;
  pointer('pointerdown', 20, 20, { shiftKey: true, altKey: true });
  pointer('pointerup', 80, 35, { shiftKey: true, altKey: true });
  expect(editor.document.items.a).toEqual(before.items.a);
  expect(worldBounds(editor.document, 'new')).toMatchObject({ x: 60, y: 0 });
  editor.undo();
  expect(editor.document).toEqual(before);
  editor.select('a');
  pointer('pointerdown', 20, 20, { shiftKey: true });
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  pointer('pointerup', 20, 20, { shiftKey: true });
  expect(editor.getSession().selectedIds).toEqual(['a']);
  expect(editor.getSession().canUndo).toBe(false);
});
