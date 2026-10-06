import { expect, it } from 'vitest';
import {
  around,
  boxHits,
  corners,
  createGraphicsEditor,
  createScene,
  type EllipseItem,
  enclosing,
  IDENTITY,
  layoutBounds,
  type Matrix,
  multiply,
  nodeCorners,
  nudgeCommand,
  type Point,
  rotation,
  scaling,
  selectionFrame,
  transformPoint,
  translation,
  worldBounds,
  worldMatrix,
} from '../src/core';

const ellipse = (
  fill = 'transparent',
  transform: Matrix = IDENTITY
): EllipseItem => ({
  id: 'ellipse',
  type: 'ellipse',
  placement: { parentId: 'scene-root', sortKey: 'a1' },
  transform,
  geometry: { width: 200, height: 100 },
  appearance: { fill, stroke: 'black', strokeWidth: 0.1 },
});

it('keeps rotated circles tight in group bounds and preserves the local resize frame', () => {
  const shape = {
    ...ellipse('red', around({ x: 32, y: 32 }, rotation(Math.PI / 6))),
    geometry: { width: 64, height: 64 },
    placement: { parentId: 'group', sortKey: 'a0' },
  };
  const doc = createScene([
    {
      id: 'group',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(200, 100),
    },
    shape,
    {
      ...shape,
      id: 'second',
      placement: { parentId: 'group', sortKey: 'a1' },
      transform: translation(96, 0),
    },
  ]);
  const expected = { x: 200, y: 100, width: 160, height: 64 };
  for (const bounds of [
    worldBounds(doc, 'group'),
    layoutBounds(doc, 'group'),
    selectionFrame(doc, ['group'])!.bounds,
    selectionFrame(doc, ['ellipse', 'second'])!.bounds,
  ]) {
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(bounds[key]).toBeCloseTo(expected[key]);
  }
  const single = selectionFrame(doc, ['ellipse'])!;
  expect(single.bounds).toEqual({ x: 0, y: 0, width: 64, height: 64 });
  expect(single.corners).toEqual(nodeCorners(doc, 'ellipse'));
});

it('encloses affine ellipse extrema through nested transforms and preview overrides', () => {
  const shape = {
    ...ellipse('red', multiply(rotation(0.6), scaling(-1, 2))),
    placement: { parentId: 'group', sortKey: 'a0' },
  };
  const doc = createScene([
    {
      id: 'group',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: [2, 0.3, 0.8, 0.5, 400, 200],
    },
    shape,
  ]);
  const editor = createGraphicsEditor(doc);
  const frame = selectionFrame(doc, ['group'])!;
  editor.beginTransform('group', frame.corners[2]!, 'se');
  editor.updateTransform({
    x: frame.bounds.x + frame.bounds.width * 1.5,
    y: frame.bounds.y + frame.bounds.height * 1.5,
  });
  const overrides = editor.getSession().transform!.nodes;
  for (const nodes of [{}, overrides]) {
    const projected = nodes.ellipse ?? shape;
    if (projected.type !== 'ellipse') throw new Error('Expected ellipse');
    const { width, height } = projected.geometry;
    const matrix = worldMatrix(doc, 'ellipse', nodes);
    const sampled = enclosing(
      Array.from({ length: 8192 }, (_, i) => {
        const t = (i * Math.PI * 2) / 8192;
        return transformPoint(matrix, {
          x: (width / 2) * (1 + Math.cos(t)),
          y: (height / 2) * (1 + Math.sin(t)),
        });
      })
    );
    const bounds = worldBounds(doc, 'group', nodes);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(bounds[key]).toBeCloseTo(sampled[key], 3);
    expect(selectionFrame(doc, ['group'], nodes)!.corners).toEqual(
      corners(bounds)
    );
  }
  const resized = worldBounds(doc, 'group', overrides);
  expect(resized.x).toBeCloseTo(frame.bounds.x);
  expect(resized.y).toBeCloseTo(frame.bounds.y);
  expect(resized.width).toBeCloseTo(frame.bounds.width * 1.5);
  expect(resized.height).toBeCloseTo(frame.bounds.height * 1.5);
  editor.commitTransform();
  editor.undo();
  expect(editor.document).toEqual(doc);
  editor.dispose();
});

it('snaps ellipse moves and keyboard nudges to the same visible bounds', () => {
  const shape = {
    ...ellipse('red', multiply(translation(3, 5), rotation(0.6))),
  };
  const editor = createGraphicsEditor([shape], { snapUnit: 8 });
  const before = editor.document;
  editor.select(shape.id);
  editor.beginTransform(shape.id, { x: 100, y: 100 });
  editor.updateTransform({ x: 108, y: 108 });
  const preview = worldBounds(
    before,
    shape.id,
    editor.getSession().transform!.nodes
  );
  expect(preview.x / 8).toBeCloseTo(Math.round(preview.x / 8));
  expect(preview.y / 8).toBeCloseTo(Math.round(preview.y / 8));
  editor.cancelTransform();
  editor.execute(nudgeCommand, { x: 8, y: 8 });
  expect(worldBounds(editor.document, shape.id)).toEqual(preview);
  editor.dispose();
});

it('picks the ellipse curve, lets its empty center through, and rejects bounding-box corners', () => {
  const editor = createGraphicsEditor([
    {
      id: 'back',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 200, height: 100 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    ellipse(),
  ]);
  expect(editor.hitTest({ x: 100, y: 50 })).toBe('back');
  expect(editor.hitTest({ x: 199, y: 50 })).toBe('ellipse');
  expect(editor.hitTest({ x: 10, y: 10 })).toBe('back');
  const filled = createGraphicsEditor([ellipse('red')]);
  expect(filled.hitTest({ x: 100, y: 50 })).toBe('ellipse');
  expect(filled.hitTest({ x: 10, y: 10 })).toBeUndefined();
});

it.each([
  0.25, 1, 4,
])('measures ellipse outline distance after rotation, shear and zoom %s', (zoom) => {
  const parent = multiply(
    translation(80, 60),
    multiply(rotation(0.4), scaling(2, 0.5))
  );
  const node = {
    ...ellipse('transparent', rotation(-0.7)),
    placement: { parentId: 'group', sortKey: 'a0' },
  };
  const editor = createGraphicsEditor([
    {
      id: 'group',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: parent,
    },
    node,
  ]);
  editor.zoomAt({ x: 0, y: 0 }, zoom);
  const world = worldMatrix(editor.document, node.id);
  for (const angle of [0, 0.7, 1.6, 3.4, 5.2]) {
    const p = transformPoint(world, {
      x: 100 + 100 * Math.cos(angle),
      y: 50 + 50 * Math.sin(angle),
    });
    const tangent: Point = {
      x: world[0] * -100 * Math.sin(angle) + world[2] * 50 * Math.cos(angle),
      y: world[1] * -100 * Math.sin(angle) + world[3] * 50 * Math.cos(angle),
    };
    const length = Math.hypot(tangent.x, tangent.y);
    const offset = (px: number) => ({
      x: p.x + ((tangent.y / length) * px) / zoom,
      y: p.y - ((tangent.x / length) * px) / zoom,
    });
    expect(editor.hitTest(offset(2.99), true)).toBe(node.id);
    expect(editor.hitTest(offset(3.01), true)).toBeUndefined();
  }
});

it('marquee uses the ellipse, not the unused corners of its bounds', () => {
  const doc = createScene([ellipse()]);
  expect(boxHits(doc, { x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
  expect(boxHits(doc, { x: 90, y: 40, width: 10, height: 10 })).toEqual([
    'ellipse',
  ]);
  expect(boxHits(doc, { x: -20, y: -20, width: 240, height: 140 })).toEqual([
    'ellipse',
  ]);
  expect(boxHits(doc, { x: 199, y: 49, width: 10, height: 2 })).toEqual([
    'ellipse',
  ]);
  expect(boxHits(doc, { x: 201, y: 49, width: 10, height: 2 })).toEqual([]);
});

it('creates and resizes ellipses through the shared gesture and history path', () => {
  const editor = createGraphicsEditor();
  editor.beginShape('ellipse', { x: 210, y: 120 });
  editor.updateShape({ x: 10, y: 20 });
  expect(Object.keys(editor.document.items)).toHaveLength(1);
  editor.commitShape('ellipse', { fill: 'transparent', stroke: 'black' });
  expect(editor.document.items.ellipse?.type).toBe('ellipse');
  editor.beginTransform('ellipse', { x: 10, y: 20 }, 'nw');
  editor.updateTransform({ x: -40, y: -30 });
  expect(editor.document.items.ellipse).toMatchObject({
    geometry: { width: 200, height: 100 },
  });
  editor.commitTransform();
  expect(editor.document.items.ellipse).toMatchObject({
    geometry: { width: 250, height: 150 },
  });
  expect(
    transformPoint(worldMatrix(editor.document, 'ellipse'), { x: 250, y: 150 })
  ).toEqual({ x: 210, y: 120 });
  editor.undo();
  expect(editor.document.items.ellipse).toMatchObject({
    geometry: { width: 200, height: 100 },
  });
  editor.undo();
  expect(editor.document.items.ellipse).toBeUndefined();
  editor.redo();
  editor.beginShape('ellipse', { x: 0, y: 0 });
  editor.updateShape({ x: 30, y: 40 });
  editor.cancelShape();
  expect(
    editor.commitShape('cancelled', { fill: 'red', stroke: 'black' })
  ).toBe(false);
});

it('groups, rotates, scales and reparents mixed shapes without losing ellipse identity', () => {
  const editor = createGraphicsEditor([
    ellipse('red'),
    {
      id: 'rect',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a2' },
      transform: translation(300, 0),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
  ]);
  editor.select('ellipse');
  editor.toggleSelection('rect');
  editor.groupSelection('group');
  editor.beginTransform('group', { x: 200, y: -30 }, 'rotate');
  editor.updateTransform({ x: 280, y: 50 });
  editor.commitTransform();
  const rotated = worldMatrix(editor.document, 'ellipse');
  const beforeResize = editor.document;
  const frame = selectionFrame(beforeResize, ['group'])!;
  editor.beginTransform('group', frame.corners[2]!, 'se');
  editor.updateTransform(
    transformPoint(frame.transform, {
      x: frame.bounds.x + frame.bounds.width * 1.5,
      y: frame.bounds.y + frame.bounds.height * 1.25,
    })
  );
  editor.commitTransform();
  const scaled = worldMatrix(editor.document, 'ellipse');
  expect(editor.document.items.ellipse).toMatchObject({
    geometry: { width: 250, height: 150 },
  });
  editor.reparent('ellipse', 'scene-root', 'front');
  worldMatrix(editor.document, 'ellipse').forEach((v, i) =>
    expect(v).toBeCloseTo(scaled[i]!)
  );
  editor.undo();
  expect(editor.document.items.ellipse).toMatchObject({
    type: 'ellipse',
    placement: { parentId: 'group' },
  });
  editor.undo();
  expect(editor.document).toEqual(beforeResize);
  worldMatrix(editor.document, 'ellipse').forEach((v, i) =>
    expect(v).toBeCloseTo(rotated[i]!)
  );
});

it('rejects invalid ellipse geometry and containment', () => {
  expect(() =>
    createScene([{ ...ellipse(), geometry: { width: -1, height: 3 } }])
  ).toThrow();
  expect(() =>
    createScene([
      { ...ellipse(), placement: { parentId: 'ellipse', sortKey: 'a1' } },
    ])
  ).toThrow();
});
