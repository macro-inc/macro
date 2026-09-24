import { expect, it } from 'vitest';
import {
  boxHits,
  createGraphicsEditor,
  createScene,
  type EllipseItem,
  IDENTITY,
  type Matrix,
  multiply,
  type Point,
  rotation,
  scaling,
  selectionFrame,
  transformPoint,
  translation,
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

it.each([0.25, 1, 4])(
  'measures ellipse outline distance after rotation, shear and zoom %s',
  (zoom) => {
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
  }
);

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
  expect(editor.document).toBe(beforeResize);
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
