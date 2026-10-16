import { afterEach, expect, it } from 'vitest';
import {
  copyFragment,
  createConnectorInteraction,
  createGraphicsEditor,
  createScene,
  duplicateCommand,
  type GraphicsDocument,
  type GraphicsEditor,
  type GraphicsItem,
  multiply,
  nudgeCommand,
  pasteCommand,
  rotation,
  type ShapeItem,
  scaling,
  snapPoint,
  snapValue,
  transformPoint,
  translation,
  worldBounds,
  worldMatrix,
} from '../src/core';
import { resizeHandles } from '../src/core/resize';
import { createGraphicsPeerLab } from './helpers/peer-lab';

const appearance = { fill: 'red', stroke: 'black' };
function rectangle(id = 'a', x = 0, y = 0): ShapeItem<'rectangle'> {
  return {
    id,
    type: 'rectangle',
    placement: { parentId: 'scene-root', sortKey: id === 'a' ? 'a0' : 'a1' },
    transform: translation(x, y),
    geometry: { width: 32, height: 16 },
    appearance,
  };
}
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()));
function setup(
  unit?: number,
  seed: readonly GraphicsItem[] | GraphicsDocument = [rectangle()]
) {
  const editor = createGraphicsEditor(seed, { snapUnit: unit });
  cleanups.push(editor.dispose);
  return editor;
}
function preview(editor: GraphicsEditor, id = 'a') {
  return worldBounds(editor.document, id, editor.getSession().transform?.nodes);
}

it.each([
  0.25, 1, 2, 2.5, 4, 8, 13,
])('snaps drawing preview and commit to arbitrary unit %s', (unit) => {
  const editor = setup(unit, []);
  editor.beginRectangle({ x: unit * 0.3, y: -unit * 1.3 });
  editor.updateRectangle({ x: unit * 4.2, y: unit * 2.8 });
  const expected = { x: 0, y: -unit, width: unit * 4, height: unit * 4 };
  expect(editor.getPreview()).toEqual(expected);
  expect(editor.commitRectangle('a', appearance)).toBe(true);
  expect(worldBounds(editor.document, 'a')).toEqual(expected);
});

it('leaves precision unrestricted by default and rejects invalid units without changing configuration', () => {
  const editor = setup();
  expect(editor.getSnapUnit()).toBeUndefined();
  const point = { x: 0.123, y: -4.567 };
  expect(snapPoint(point)).toEqual(point);
  expect(Object.is(snapValue(-0.1, 1), -0)).toBe(false);
  expect(snapValue(0.36, 0.1)).toBeCloseTo(0.4);
  for (const unit of [0, -1, NaN, Infinity]) {
    expect(() => createGraphicsEditor([], { snapUnit: unit })).toThrow(
      'positive finite'
    );
    expect(() => editor.setSnapUnit(unit)).toThrow('positive finite');
    expect(editor.getSnapUnit()).toBeUndefined();
  }
  editor.beginTransform('a', { x: 5, y: 6 });
  editor.updateTransform({ x: 5.3, y: 6.5 });
  expect(preview(editor).x).toBeCloseTo(0.3);
  expect(preview(editor).y).toBeCloseTo(0.5);
});

it('snaps the common selection anchor while preserving grab offset, spacing, and one undo step', () => {
  const editor = setup(8, [rectangle('a', 3, 5), rectangle('b', 50, 27)]);
  editor.select('a');
  editor.toggleSelection('b');
  const before = editor.document;
  editor.beginTransform('a', { x: 11, y: 12 });
  editor.updateTransform({ x: 11, y: 12 });
  expect(editor.commitTransform()).toBe(false);
  editor.beginTransform('a', { x: 11, y: 12 });
  editor.updateTransform({ x: 17, y: 19 });
  expect(editor.document).toBe(before);
  expect(preview(editor)).toMatchObject({ x: 8, y: 16 });
  expect(preview(editor, 'b')).toMatchObject({ x: 55, y: 38 });
  editor.commitTransform();
  expect(worldBounds(editor.document, 'a')).toMatchObject({ x: 8, y: 16 });
  editor.undo();
  expect(editor.document).toEqual(before);
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  expect(worldBounds(editor.document, 'b')).toMatchObject({ x: 55, y: 38 });
});

it('snaps nested moves in world coordinates and preserves the constrained axis', () => {
  const editor = setup(4, [
    {
      id: 'g',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: multiply(
        translation(51, 63),
        multiply(rotation(0.6), scaling(2, 3))
      ),
    },
    { ...rectangle(), placement: { parentId: 'g', sortKey: 'a0' } },
  ]);
  const before = worldBounds(editor.document, 'a');
  editor.beginTransform('a', { x: 20, y: 40 });
  editor.updateTransform({ x: 27, y: 41 }, { constrainAxis: true });
  expect(preview(editor).x / 4).toBeCloseTo(Math.round((before.x + 7) / 4));
  expect(preview(editor).y).toBeCloseTo(before.y);
  editor.cancelTransform();
  expect(editor.getSession().canUndo).toBe(false);
});

it.each(
  resizeHandles
)('snaps dimensions with handle %s and keeps the opposite edge fixed', (handle) => {
  const editor = setup(8);
  const horizontal = handle.includes('e') || handle.includes('w');
  const vertical = handle.includes('n') || handle.includes('s');
  const west = handle.includes('w'),
    north = handle.includes('n');
  const start = { x: (west ? 0 : 32) + 2, y: (north ? 0 : 16) - 1 };
  editor.beginTransform('a', start, handle);
  editor.updateTransform({
    x: start.x + (west ? -11 : 11),
    y: start.y + (north ? -7 : 7),
  });
  const expected = {
    x: west ? -8 : 0,
    y: north ? -8 : 0,
    width: horizontal ? 40 : 32,
    height: vertical ? 24 : 16,
  };
  expect(preview(editor)).toEqual(expected);
  editor.commitTransform();
  expect(worldBounds(editor.document, 'a')).toEqual(expected);
});

it('accounts for rotation and ancestor scale when snapping physical dimensions', () => {
  const matrix = multiply(
    translation(13, 27),
    multiply(rotation(0.6), scaling(2, 3))
  );
  const editor = setup(8, [{ ...rectangle(), transform: matrix }]);
  editor.beginTransform('a', transformPoint(matrix, { x: 32, y: 16 }), 'se');
  editor.updateTransform(transformPoint(matrix, { x: 37.4, y: 19.3 }));
  editor.commitTransform();
  const item = editor.document.items.a;
  if (item?.type !== 'rectangle') throw new Error('Missing rectangle');
  const world = worldMatrix(editor.document, 'a');
  expect(item.geometry.width * Math.hypot(world[0], world[1])).toBeCloseTo(72);
  expect(item.geometry.height * Math.hypot(world[2], world[3])).toBeCloseTo(56);
  expect(world[4]).toBeCloseTo(matrix[4]);
  expect(world[5]).toBeCloseTo(matrix[5]);
});

it('preserves proportional and center constraints, including group scaling', () => {
  for (const grouped of [false, true]) {
    const editor = setup(8);
    if (grouped) {
      editor.select('a');
      editor.groupSelection('g');
    }
    const id = grouped ? 'g' : 'a';
    editor.beginTransform(id, { x: 32, y: 16 }, 'se');
    editor.updateTransform(
      { x: 38, y: 18 },
      { proportional: true, fromCenter: true }
    );
    expect(preview(editor, id)).toEqual({
      x: -8,
      y: -4,
      width: 48,
      height: 24,
    });
  }
});

it('gives bounded image edges priority over snapping for drawing, resizing, and moving', () => {
  const editor = setup(8, []);
  editor.setImageSurface({ id: 'image', width: 101, height: 79 });
  editor.beginRectangle({ x: 8, y: 8 });
  editor.updateRectangle({ x: 500, y: 500 });
  expect(editor.getPreview()).toEqual({ x: 8, y: 8, width: 93, height: 71 });
  editor.commitRectangle('a', appearance);
  editor.beginTransform('a', { x: 101, y: 79 }, 'se');
  editor.updateTransform({ x: 500, y: 500 });
  expect(preview(editor)).toEqual({ x: 8, y: 8, width: 93, height: 71 });
  editor.cancelTransform();
  editor.beginTransform('a', { x: 50, y: 50 });
  editor.updateTransform({ x: 500, y: 500 });
  expect(preview(editor)).toEqual({ x: 8, y: 8, width: 93, height: 71 });
});

it('keeps freehand samples and rotation independent of pixel snapping', () => {
  const snapped = setup(8),
    free = setup();
  for (const editor of [snapped, free]) {
    editor.beginShape('pencil', { x: 1.3, y: 3.7, pressure: 0.4 });
    editor.updateShape({ x: 4.6, y: 7.8, pressure: 0.6 });
    editor.updateShape({ x: 11.2, y: 4.1, pressure: 0.7 });
    editor.commitShape('ink', appearance);
    editor.beginTransform('a', { x: 16, y: -10 }, 'rotate');
    editor.updateTransform({ x: 30.3, y: -2.6 });
  }
  expect(snapped.document.items.ink).toEqual(free.document.items.ink);
  expect(snapped.getSession().transform?.nodes).toEqual(
    free.getSession().transform?.nodes
  );
});

it('changes local policy without writing history and snaps keyboard moves on only the active axis', () => {
  const editor = setup(4, [rectangle('a', 3, 5)]);
  const before = editor.document;
  editor.beginTransform('a', { x: 10, y: 10 });
  editor.updateTransform({ x: 20, y: 20 });
  editor.setSnapUnit(8);
  expect(editor.getSession().snapUnit).toBe(8);
  expect(editor.getSession().transform).toBeUndefined();
  expect(editor.document).toBe(before);
  expect(editor.getSession().canUndo).toBe(false);
  editor.execute(nudgeCommand, { x: 8, y: 0 });
  expect(worldBounds(editor.document, 'a')).toMatchObject({ x: 8, y: 5 });
  editor.setSnapUnit(undefined);
  editor.execute(nudgeCommand, { x: 0.2, y: 0.3 });
  expect(worldBounds(editor.document, 'a').x).toBeCloseTo(8.2);
  expect(worldBounds(editor.document, 'a').y).toBeCloseTo(5.3);
});

it('snaps free connector ends, retaining exact bound ports and Shift angles', () => {
  const doc = createScene([rectangle('a', 3, 5)]);
  const op = createConnectorInteraction({
    getDocument: () => doc,
    getSnapUnit: () => 8,
    commit: () => {},
    onChange: () => {},
  });
  op.begin(
    'connector',
    { x: 81, y: 83 },
    appearance,
    { route: 'straight', startHead: 'none', endHead: 'arrow' },
    1
  );
  op.update({ x: 105, y: 107 }, 1);
  expect(op.getState()?.item.geometry).toMatchObject({
    start: { point: { x: 80, y: 80 } },
    end: { point: { x: 104, y: 104 } },
  });
  op.update({ x: 101, y: 98 }, 1, true);
  const end = op.getState()!.item.geometry.end.point;
  expect(end.x).toBeCloseTo(96);
  expect(end.y).toBeCloseTo(96);
  op.update({ x: 35, y: 13 }, 1);
  expect(op.getState()?.item.geometry.end).toMatchObject({
    point: { x: 35, y: 13 },
    binding: { targetId: 'a' },
  });
});

it('stores snapped poses through Loro while each peer keeps its own unit', () => {
  const lab = createGraphicsPeerLab(createScene([rectangle()]));
  cleanups.push(lab.dispose);
  lab.setConnected(false);
  const a = lab.peers[0]!.editor,
    b = lab.peers[1]!.editor;
  a.setSnapUnit(2.5);
  b.setSnapUnit(8);
  a.beginTransform('a', { x: 0, y: 0 });
  a.updateTransform({ x: 6.2, y: 8.1 });
  a.commitTransform();
  lab.syncNow();
  expect(a.document).toEqual(b.document);
  expect(worldBounds(b.document, 'a')).toMatchObject({ x: 5, y: 7.5 });
  expect(b.getSnapUnit()).toBe(8);
  a.undo();
  lab.syncNow();
  expect(worldBounds(b.document, 'a')).toMatchObject({ x: 0, y: 0 });
});

it('snaps duplicate and paste anchors without changing the spacing inside a fragment', () => {
  const editor = setup(13, [rectangle('a', 3, 5), rectangle('b', 50, 27)]);
  editor.select('a');
  editor.toggleSelection('b');
  const fragment = copyFragment(editor.document, ['a', 'b'])!;
  let count = 0;
  const createId = () => `copy-${count++}`;
  editor.execute(duplicateCommand, { createId });
  expect(worldBounds(editor.document, 'copy-0')).toMatchObject({
    x: 26,
    y: 26,
  });
  expect(worldBounds(editor.document, 'copy-1')).toMatchObject({
    x: 73,
    y: 48,
  });
  editor.execute(pasteCommand, {
    fragment,
    createId,
    offset: { x: 30, y: 40 },
  });
  expect(worldBounds(editor.document, 'copy-2')).toMatchObject({
    x: 39,
    y: 39,
  });
  expect(worldBounds(editor.document, 'copy-3')).toMatchObject({
    x: 86,
    y: 61,
  });
  // An explicitly requested in-place copy retains the exact source pose.
  editor.execute(pasteCommand, { fragment, createId, offset: { x: 0, y: 0 } });
  expect(worldBounds(editor.document, 'copy-4')).toMatchObject({ x: 3, y: 5 });
});
