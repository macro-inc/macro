import { describe, expect, it } from 'vitest';
import {
  around,
  boxHits,
  children,
  createGraphicsEditor,
  createScene,
  deleteSubtrees,
  freezeDocument,
  type GraphicsDocument,
  type GraphicsItem,
  groupNodes,
  hitTest,
  IDENTITY,
  inverse,
  type Matrix,
  multiply,
  nodeCorners,
  reparent,
  roots,
  rotation,
  scaling,
  selectionFrame,
  transformPoint,
  translation,
  ungroupNode,
  worldBounds,
  worldMatrix,
} from '../src/core';

const closeMatrix = (a: Matrix, b: Matrix) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? 0, 8));
const fixture = (): GraphicsDocument =>
  createScene([
    {
      id: 'outer',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: multiply(
        translation(100, 80),
        multiply(rotation(0.4), scaling(1.6, 0.7))
      ),
    },
    {
      id: 'inner',
      type: 'group',
      placement: { parentId: 'outer', sortKey: 'a0' },
      transform: multiply(translation(50, 30), rotation(-0.7)),
    },
    {
      id: 'a',
      type: 'rectangle',
      placement: { parentId: 'inner', sortKey: 'a0' },
      transform: translation(10, 20),
      geometry: { width: 80, height: 50 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(400, 100),
      geometry: { width: 70, height: 40 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
  ]);
describe('scene foundation', () => {
  it('composes and inverts nested affine transforms including reflection and shear', () => {
    const matrix = multiply(
      translation(70, -80),
      multiply(rotation(0.7), multiply(scaling(-2, 0.3), rotation(-0.4)))
    );
    const point = { x: 31, y: -29 };
    const back = transformPoint(inverse(matrix), transformPoint(matrix, point));
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
    closeMatrix(multiply(matrix, inverse(matrix)), IDENTITY);
    expect(() => inverse(scaling(0, 1))).toThrow();
    expect(() => inverse(translation(Infinity, 0))).toThrow();
  });
  it('preserves world pose when reparenting and rejects cycles without partial edits', () => {
    const doc = fixture(),
      before = worldMatrix(doc, 'a');
    const moved = reparent(doc, 'a', 'scene-root', 'front');
    closeMatrix(worldMatrix(moved, 'a'), before);
    expect(children(moved, 'inner')).toEqual([]);
    expect(() => reparent(doc, 'outer', 'inner', 'front')).toThrow();
    expect(children(doc, 'inner')).toEqual(['a']);
    expect(() => reparent(doc, 'a', 'b', 'front')).toThrow();
  });
  it('groups and ungroups preserving geometry, order and identity', () => {
    const doc = createScene([
      {
        id: 'a',
        type: 'rectangle',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: translation(10, 10),
        geometry: { width: 20, height: 20 },
        appearance: { fill: 'red', stroke: 'black' },
      },
      {
        id: 'b',
        type: 'rectangle',
        placement: { parentId: 'scene-root', sortKey: 'a1' },
        transform: translation(50, 10),
        geometry: { width: 20, height: 20 },
        appearance: { fill: 'blue', stroke: 'black' },
      },
    ]);
    const grouped = groupNodes(doc, ['b', 'a'], 'g');
    expect(children(grouped)).toEqual(['g']);
    expect(children(grouped, 'g')).toEqual(['a', 'b']);
    closeMatrix(worldMatrix(grouped, 'a'), worldMatrix(doc, 'a'));
    const ungrouped = ungroupNode(grouped, 'g');
    expect(children(ungrouped)).toEqual(['a', 'b']);
    closeMatrix(worldMatrix(ungrouped, 'b'), worldMatrix(doc, 'b'));
  });
  it('normalizes selected roots and removes subtrees atomically with undo', () => {
    const editor = createGraphicsEditor(fixture());
    editor.select('outer');
    editor.toggleSelection('a');
    expect(roots(editor.document, editor.getSession().selectedIds)).toEqual([
      'outer',
    ]);
    const before = worldMatrix(editor.document, 'a');
    editor.beginTransform('outer', { x: 0, y: 0 });
    editor.updateTransform({ x: 30, y: 10 });
    editor.commitTransform();
    closeMatrix(
      worldMatrix(editor.document, 'a'),
      multiply(translation(30, 10), before)
    );
    editor.undo();
    closeMatrix(worldMatrix(editor.document, 'a'), before);
    editor.deleteSelection();
    expect(editor.document.items.a).toBeUndefined();
    editor.undo();
    closeMatrix(worldMatrix(editor.document, 'a'), before);
    expect(deleteSubtrees(fixture(), ['inner']).items.outer).toBeDefined();
  });
  it('moves nodes under different parents in world space and rotates a nested subtree in one undo step', () => {
    const editor = createGraphicsEditor(fixture());
    editor.select('a');
    editor.toggleSelection('b');
    const a = worldMatrix(editor.document, 'a'),
      b = worldMatrix(editor.document, 'b');
    editor.beginTransform('a', { x: 0, y: 0 });
    editor.updateTransform({ x: 20, y: -10 });
    editor.commitTransform();
    closeMatrix(
      worldMatrix(editor.document, 'a'),
      multiply(translation(20, -10), a)
    );
    closeMatrix(
      worldMatrix(editor.document, 'b'),
      multiply(translation(20, -10), b)
    );
    editor.undo();
    editor.select('inner');
    const bounds = worldBounds(editor.document, 'inner');
    const pivot = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    editor.beginTransform('inner', { x: pivot.x + 100, y: pivot.y }, 'rotate');
    editor.updateTransform({ x: pivot.x, y: pivot.y + 100 });
    expect(editor.document.items.inner).toEqual(fixture().items.inner);
    editor.commitTransform();
    closeMatrix(
      worldMatrix(editor.document, 'a'),
      multiply(around(pivot, rotation(Math.PI / 2)), a)
    );
    editor.undo();
    closeMatrix(worldMatrix(editor.document, 'a'), a);
    expect(editor.getSession().canUndo).toBe(false);
  });
  it('keeps the opposite corner fixed while resizing under rotated and scaled ancestors', () => {
    const editor = createGraphicsEditor(fixture());
    const node = editor.document.items.a;
    if (node?.type !== 'rectangle') throw new Error('fixture');
    const world = worldMatrix(editor.document, 'a');
    const start = transformPoint(world, {
      x: node.geometry.width,
      y: node.geometry.height,
    });
    const end = transformPoint(world, { x: 120, y: 90 });
    editor.select('a');
    editor.beginTransform('a', start, 'se');
    editor.updateTransform(end);
    editor.commitTransform();
    closeMatrix(worldMatrix(editor.document, 'a'), world);
    const resized = editor.document.items.a;
    if (resized?.type !== 'rectangle') throw new Error('fixture');
    expect(resized.geometry.width).toBeCloseTo(120);
    expect(resized.geometry.height).toBeCloseTo(90);
    editor.undo();
    closeMatrix(worldMatrix(editor.document, 'a'), world);
  });
  it('hit tests actual transformed polygons instead of enclosing bounds', () => {
    const node: GraphicsItem = {
      id: 'r',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: rotation(Math.PI / 4),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'red', stroke: 'black' },
    };
    const doc = createScene([node]);
    expect(hitTest(doc, { x: -60, y: 5 })).toBeUndefined();
    expect(boxHits(doc, { x: -65, y: 0, width: 5, height: 5 })).toEqual([]);
    expect(hitTest(doc, { x: 0, y: 50 })).toBe('r');
    expect(boxHits(doc, { x: -2, y: 48, width: 4, height: 4 })).toEqual(['r']);
    const nested = fixture(),
      center = transformPoint(worldMatrix(nested, 'a'), { x: 40, y: 25 });
    expect(hitTest(nested, center)).toBe('outer');
    expect(hitTest(nested, center, true)).toBe('a');
    expect(nodeCorners(nested, 'a')).toHaveLength(4);
  });
  it('rejects invalid roots, placements and transforms before history changes', () => {
    const doc = fixture(),
      node = doc.items.b;
    if (node?.type !== 'rectangle') throw new Error('fixture');
    expect(() =>
      freezeDocument({
        ...doc,
        items: { ...doc.items, b: { ...node, transform: scaling(0) } },
      })
    ).toThrow();
    expect(() =>
      freezeDocument({
        ...doc,
        items: {
          ...doc.items,
          b: { ...node, placement: { parentId: 'missing', sortKey: 'a0' } },
        },
      })
    ).toThrow();
    const editor = createGraphicsEditor(doc);
    expect(() => editor.reparent('outer', 'inner', 'front')).toThrow();
    expect(editor.getSession().canUndo).toBe(false);
  });
});

it('scales a mixed-parent selection around the opposite corner and commits one undo step', () => {
  const editor = createGraphicsEditor(fixture());
  editor.select('a');
  editor.toggleSelection('b');
  const originalA = worldMatrix(editor.document, 'a'),
    originalB = worldMatrix(editor.document, 'b');
  const a = worldBounds(editor.document, 'a'),
    b = worldBounds(editor.document, 'b');
  const left = Math.min(a.x, b.x),
    top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width),
    bottom = Math.max(a.y + a.height, b.y + b.height);
  const start = { x: right, y: bottom },
    end = { x: right + (right - left), y: bottom + (bottom - top) * 0.5 };
  editor.beginTransform('a', start, 'se');
  editor.updateTransform(end);
  expect(editor.getSession().transform?.kind).toBe('scale');
  closeMatrix(worldMatrix(editor.document, 'a'), originalA);
  editor.commitTransform();
  const delta = around({ x: left, y: top }, scaling(2));
  closeMatrix(worldMatrix(editor.document, 'a'), multiply(delta, originalA));
  closeMatrix(worldMatrix(editor.document, 'b'), multiply(delta, originalB));
  editor.undo();
  closeMatrix(worldMatrix(editor.document, 'a'), originalA);
  closeMatrix(worldMatrix(editor.document, 'b'), originalB);
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  closeMatrix(worldMatrix(editor.document, 'a'), multiply(delta, originalA));
});

it('scales a selected subtree once, preserves the opposite anchor and supports cancellation', () => {
  for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
    const editor = createGraphicsEditor(fixture());
    editor.select('outer');
    editor.toggleSelection('a');
    const before = worldMatrix(editor.document, 'a'),
      frame = selectionFrame(editor.document, ['outer'])!,
      bounds = frame.bounds;
    const west = corner.endsWith('w'),
      north = corner.startsWith('n');
    const start = {
      x: west ? bounds.x : bounds.x + bounds.width,
      y: north ? bounds.y : bounds.y + bounds.height,
    };
    const anchor = {
      x: west ? bounds.x + bounds.width : bounds.x,
      y: north ? bounds.y + bounds.height : bounds.y,
    };
    editor.beginTransform(
      'outer',
      transformPoint(frame.transform, start),
      corner
    );
    editor.updateTransform(
      transformPoint(frame.transform, {
        x: start.x + (west ? -1 : 1) * bounds.width,
        y: start.y + (north ? -1 : 1) * bounds.height,
      })
    );
    editor.commitTransform();
    closeMatrix(
      worldMatrix(editor.document, 'a'),
      multiply(
        around(transformPoint(frame.transform, anchor), scaling(2)),
        before
      )
    );
    editor.undo();
    editor.beginTransform(
      'outer',
      transformPoint(frame.transform, start),
      corner
    );
    editor.updateTransform(transformPoint(frame.transform, anchor));
    expect(editor.getSession().transform).toBeDefined();
    editor.cancelTransform();
    closeMatrix(worldMatrix(editor.document, 'a'), before);
    expect(editor.getSession().canUndo).toBe(false);
  }
});

it('preserves right angles, orientation and aspect ratios when scaling rotated multiselection with an uneven drag', () => {
  const doc = createScene([
    {
      id: 'a',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: multiply(translation(30, 40), rotation(0.6)),
      geometry: { width: 100, height: 60 },
      appearance: { fill: 'red', stroke: 'black' },
    },
    {
      id: 'b',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: multiply(translation(180, 150), rotation(-0.4)),
      geometry: { width: 70, height: 40 },
      appearance: { fill: 'blue', stroke: 'black' },
    },
  ]);
  const editor = createGraphicsEditor(doc);
  editor.select('a');
  editor.toggleSelection('b');
  const bounds = worldBounds(doc, doc.rootId);
  const start = { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
  editor.beginTransform('a', start, 'se');
  editor.updateTransform({
    x: start.x + bounds.width * 0.5,
    y: start.y - bounds.height * 0.8,
  });
  editor.commitTransform();
  for (const id of ['a', 'b']) {
    const before = worldMatrix(doc, id),
      after = worldMatrix(editor.document, id);
    expect(after[0] * after[2] + after[1] * after[3]).toBeCloseTo(0);
    expect(Math.atan2(after[1], after[0])).toBeCloseTo(
      Math.atan2(before[1], before[0])
    );
    expect(
      Math.hypot(after[0], after[1]) / Math.hypot(after[2], after[3])
    ).toBeCloseTo(1);
    closeMatrix(
      after,
      multiply(around({ x: bounds.x, y: bounds.y }, scaling(1.5)), before)
    );
  }
});
