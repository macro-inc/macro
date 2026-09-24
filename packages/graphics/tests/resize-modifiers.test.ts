import { expect, it, vi } from 'vitest';
import { attachCameraControls } from '../src/browser';
import {
  createGraphicsEditor,
  multiply,
  type Point,
  rotation,
  type ShapeKind,
  scaling,
  transformPoint,
  translation,
  worldBounds,
  worldMatrix,
} from '../src/core';

const closePoint = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 8);
  expect(a.y).toBeCloseTo(b.y, 8);
};
const nestedEditor = (kind: ShapeKind) =>
  createGraphicsEditor([
    {
      id: 'parent',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: multiply(
        translation(100, 80),
        multiply(rotation(0.4), scaling(1.8, 0.7))
      ),
    },
    {
      id: 'shape',
      ...(kind === 'rectangle'
        ? { type: 'rectangle' as const }
        : { type: 'ellipse' as const }),
      placement: { parentId: 'parent', sortKey: 'a0' },
      transform: multiply(translation(40, 50), rotation(-0.6)),
      geometry: { width: 200, height: 100 },
      appearance: { fill: 'transparent', stroke: 'black' },
    },
  ]);

it.each(['rectangle', 'ellipse'] as const)(
  'keeps the opposite corner fixed and preserves aspect ratio for a nested %s',
  (kind) => {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
      const editor = nestedEditor(kind);
      const before = editor.document;
      const world = worldMatrix(before, 'shape');
      const west = corner.endsWith('w'),
        north = corner.startsWith('n');
      const origin = { x: (west ? 0 : 200) + 3, y: (north ? 0 : 100) - 2 };
      const fixed = transformPoint(world, {
        x: west ? 200 : 0,
        y: north ? 100 : 0,
      });
      editor.beginTransform('shape', transformPoint(world, origin), corner);
      editor.updateTransform(
        transformPoint(world, {
          x: origin.x + (west ? -80 : 80),
          y: origin.y + (north ? -10 : 10),
        }),
        { proportional: true }
      );
      expect(editor.document).toBe(before);
      const overrides = editor.getSession().transform?.nodes;
      expect(overrides?.shape).toMatchObject({
        geometry: { width: 280, height: 140 },
      });
      closePoint(
        transformPoint(worldMatrix(before, 'shape', overrides), {
          x: west ? 280 : 0,
          y: north ? 140 : 0,
        }),
        fixed
      );
      editor.commitTransform();
      editor.undo();
      expect(editor.document).toBe(before);
    }
  }
);

it.each([false, true])(
  'holds the original center with proportional=%s through nested transforms',
  (proportional) => {
    const editor = nestedEditor('ellipse');
    const world = worldMatrix(editor.document, 'shape');
    const center = transformPoint(world, { x: 100, y: 50 });
    editor.beginTransform(
      'shape',
      transformPoint(world, { x: 200, y: 100 }),
      'se'
    );
    editor.updateTransform(transformPoint(world, { x: 230, y: 90 }), {
      fromCenter: true,
      proportional,
    });
    const nodes = editor.getSession().transform?.nodes;
    const expectedHeight = proportional ? 130 : 80;
    const previewShape = nodes?.shape;
    if (previewShape?.type !== 'ellipse')
      throw new Error('Missing ellipse preview');
    expect(previewShape.geometry.width).toBeCloseTo(260, 8);
    expect(previewShape.geometry.height).toBeCloseTo(expectedHeight, 8);
    closePoint(
      transformPoint(worldMatrix(editor.document, 'shape', nodes), {
        x: 130,
        y: expectedHeight / 2,
      }),
      center
    );
    editor.cancelTransform();
    expect(editor.getSession().canUndo).toBe(false);
  }
);

it('scales a mixed selection around its collective center in one undo step', () => {
  const editor = createGraphicsEditor([
    {
      id: 'a',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'ellipse',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(200, 0),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'red', stroke: 'black' },
    },
  ]);
  const before = editor.document;
  editor.select('a');
  editor.toggleSelection('b');
  editor.beginTransform('a', { x: 300, y: 100 }, 'se');
  editor.updateTransform(
    { x: 330, y: 105 },
    { fromCenter: true, proportional: true }
  );
  editor.commitTransform();
  const bounds = worldBounds(editor.document, editor.document.rootId);
  closePoint(
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    { x: 150, y: 50 }
  );
  expect(bounds.width).toBeCloseTo(360);
  expect(bounds.height).toBeCloseTo(120);
  editor.undo();
  expect(editor.document).toBe(before);
});

it('updates modifiers at a stationary pointer and uses the final pointer-up modifiers', () => {
  const editor = createGraphicsEditor([
    {
      id: 'a',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(20, 20),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'red', stroke: 'black' },
    },
  ]);
  const viewport = document.createElement('div');
  document.body.append(viewport);
  const handle = document.createElement('div');
  handle.dataset.graphicsHandle = 'se';
  viewport.append(handle);
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  const detach = attachCameraControls(viewport, editor, {
    tool: () => 'select',
    editing: true,
  });
  editor.select('a');
  const changed = vi.fn();
  editor.subscribeDocument(changed);
  const pointer = (
    target: HTMLElement,
    type: string,
    x: number,
    y: number,
    modifiers = {}
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      ...modifiers,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  const key = (type: string, key: string, shiftKey: boolean, altKey: boolean) =>
    viewport.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        shiftKey,
        altKey,
        bubbles: true,
        cancelable: true,
      })
    );
  const geometry = () => editor.getSession().transform?.nodes.a;
  pointer(handle, 'pointerdown', 120, 100, { shiftKey: true, altKey: true });
  expect(editor.getSession().selectedIds).toEqual(['a']);
  pointer(viewport, 'pointermove', 150, 110);
  expect(geometry()).toMatchObject({ geometry: { width: 130, height: 90 } });
  key('keydown', 'Shift', true, false);
  expect(geometry()).toMatchObject({ geometry: { width: 130, height: 104 } });
  key('keydown', 'Alt', true, true);
  expect(geometry()).toMatchObject({ geometry: { width: 160, height: 128 } });
  key('keyup', 'Shift', false, true);
  expect(geometry()).toMatchObject({ geometry: { width: 160, height: 100 } });
  key('keyup', 'Alt', false, false);
  expect(geometry()).toMatchObject({ geometry: { width: 130, height: 90 } });
  expect(changed).not.toHaveBeenCalled();
  pointer(viewport, 'pointerup', 150, 110, { shiftKey: true, altKey: true });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(editor.document.items.a).toMatchObject({
    geometry: { width: 160, height: 128 },
  });
  closePoint(
    transformPoint(worldMatrix(editor.document, 'a'), { x: 80, y: 64 }),
    { x: 70, y: 60 }
  );
  detach();
  viewport.remove();
});
