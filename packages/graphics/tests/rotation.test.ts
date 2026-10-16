import { expect, it, vi } from 'vitest';
import { attachCameraControls } from '../src/browser';
import {
  createGraphicsEditor,
  multiply,
  type Point,
  rotation,
  scaling,
  translation,
  worldBounds,
  worldMatrix,
} from '../src/core';

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const pointerAt = (pivot: Point, degrees: number) => ({
  x: pivot.x + 100 * Math.sin(radians(degrees)),
  y: pivot.y - 100 * Math.cos(radians(degrees)),
});
const angle = (matrix: readonly number[]) =>
  (Math.atan2(matrix[1]!, matrix[0]!) * 180) / Math.PI;

it.each([
  1, -1,
])('snaps nested shapes and groups to absolute world angles in direction %s', (direction) => {
  for (const id of ['shape', 'parent']) {
    const editor = createGraphicsEditor([
      {
        id: 'parent',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: multiply(
          translation(100, 80),
          multiply(rotation(radians(23 * direction)), scaling(1.6, 0.8))
        ),
      },
      {
        id: 'shape',
        type: 'rectangle',
        placement: { parentId: 'parent', sortKey: 'a0' },
        transform: multiply(
          translation(40, 50),
          rotation(radians(-12 * direction))
        ),
        geometry: { width: 200, height: 100 },
        appearance: { fill: 'red', stroke: 'black' },
      },
    ]);
    const before = editor.document;
    const bounds = worldBounds(before, id);
    const pivot = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    editor.beginTransform(id, pointerAt(pivot, 0), 'rotate');
    editor.updateTransform(pointerAt(pivot, 11 * direction), {
      snapRotation: true,
    });
    expect(editor.document).toBe(before);
    const nodes = editor.getSession().transform?.nodes;
    expect(angle(worldMatrix(before, id, nodes))).toBeCloseTo(30 * direction);
    const preview = worldBounds(before, id, nodes);
    expect(preview.x + preview.width / 2).toBeCloseTo(pivot.x);
    expect(preview.y + preview.height / 2).toBeCloseTo(pivot.y);
    editor.commitTransform();
    editor.undo();
    expect(editor.document).toEqual(before);
    expect(editor.getSession().canUndo).toBe(false);
  }
});

it('snaps a multiselection as a whole while retaining relative angles', () => {
  const editor = createGraphicsEditor(
    [17, -23].map((degrees, index) => ({
      id: String(index),
      type: 'rectangle' as const,
      placement: { parentId: 'scene-root', sortKey: `a${index}` },
      transform: multiply(
        translation(index * 200, 0),
        rotation(radians(degrees))
      ),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'red', stroke: 'black' },
    }))
  );
  editor.select('0');
  editor.toggleSelection('1');
  const bounds = worldBounds(editor.document, editor.document.rootId);
  const pivot = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  editor.beginTransform('0', pointerAt(pivot, 0), 'rotate');
  editor.updateTransform(pointerAt(pivot, 41), { snapRotation: true });
  const nodes = editor.getSession().transform?.nodes;
  expect(angle(worldMatrix(editor.document, '0', nodes))).toBeCloseTo(47);
  expect(angle(worldMatrix(editor.document, '1', nodes))).toBeCloseTo(7);
  editor.updateTransform(pointerAt(pivot, 41));
  expect(
    angle(
      worldMatrix(editor.document, '0', editor.getSession().transform?.nodes)
    )
  ).toBeCloseTo(58);
  editor.cancelTransform();
  expect(editor.getSession().canUndo).toBe(false);
});

it('updates rotation snapping on stationary Shift changes and commits pointer-up modifiers once', () => {
  const editor = createGraphicsEditor([
    {
      id: 'shape',
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
  handle.dataset.graphicsHandle = 'rotate';
  viewport.append(handle);
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  const detach = attachCameraControls(viewport, editor, {
    tool: () => 'select',
  });
  editor.select('shape');
  const changed = vi.fn();
  editor.subscribeDocument(changed);
  const pointer = (
    target: HTMLElement,
    type: string,
    degrees: number,
    shiftKey = false
  ) => {
    const point = pointerAt({ x: 70, y: 60 }, degrees);
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: point.x,
      clientY: point.y,
      shiftKey,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  const previewAngle = () =>
    angle(
      worldMatrix(
        editor.document,
        'shape',
        editor.getSession().transform?.nodes
      )
    );
  pointer(handle, 'pointerdown', 0);
  pointer(viewport, 'pointermove', 41, true);
  expect(previewAngle()).toBeCloseTo(30);
  viewport.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
  expect(previewAngle()).toBeCloseTo(41);
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true })
  );
  expect(previewAngle()).toBeCloseTo(30);
  expect(changed).not.toHaveBeenCalled();
  pointer(viewport, 'pointerup', 79, true);
  expect(angle(worldMatrix(editor.document, 'shape'))).toBeCloseTo(90);
  expect(changed).toHaveBeenCalledTimes(1);
  detach();
  viewport.remove();
});
