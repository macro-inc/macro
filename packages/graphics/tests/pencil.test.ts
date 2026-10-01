import { expect, it } from 'vitest';
import {
  boxHits,
  copyFragment,
  createGraphicsEditor,
  createScene,
  drawableIds,
  freezeDocument,
  IDENTITY,
  multiply,
  type PencilItem,
  parseFragment,
  pasteFragment,
  rotation,
  scaling,
  selectionFrame,
  transformPoint,
  translation,
  worldMatrix,
} from '../src/core';
import { pencilDefinition, pencilInk } from '../src/core/shapes/pencil';
import { createGraphicsPeerLab } from '../src/loro';

const appearance = { fill: 'red', stroke: 'black', strokeWidth: 12 };
const pencil = (simulatePressure = true): PencilItem => ({
  id: 'ink',
  type: 'pencil',
  placement: { parentId: 'scene-root', sortKey: 'a1' },
  transform: IDENTITY,
  geometry: {
    simulatePressure,
    points: Array.from({ length: 60 }, (_, i) => [
      i * 4,
      60 * Math.sin(i / 10),
      0.5,
    ]),
  },
  appearance,
});

it('keeps one stroke transient until release and commits one undo step, including dots', () => {
  const editor = createGraphicsEditor();
  const before = editor.document;
  editor.beginShape('pencil', { x: 100, y: 150 });
  editor.updateDrawing([
    { x: 105, y: 160 },
    { x: 120, y: 170 },
    { x: 180, y: 160 },
  ]);
  expect(editor.document).toBe(before);
  const preview = editor.getDrawingPreview(appearance)!;
  expect(editor.commitShape('ink', appearance, 3)).toBe(true);
  const stroke = editor.document.items.ink;
  expect(stroke).toMatchObject({
    type: 'pencil',
    geometry: preview.geometry,
    transform: preview.transform,
  });
  editor.undo();
  expect(editor.document).toEqual(before);
  editor.redo();
  expect(editor.document.items.ink).toEqual(stroke);
  editor.beginShape('pencil', { x: 10, y: 20, pressure: 0.8 });
  expect(editor.commitShape('dot', appearance, 3)).toBe(true);
  expect(editor.hitTest({ x: 10, y: 20 })).toBe('dot');
  editor.beginShape('pencil', { x: 20, y: 20 });
  editor.cancelShape();
  expect(editor.commitShape('cancelled', appearance)).toBe(false);
});

it('uses point spacing for mouse width and actual pressure for pen width', () => {
  const line = (
    spacing: number,
    pressure = 0.5,
    simulatePressure = true
  ): PencilItem => ({
    ...pencil(),
    geometry: {
      simulatePressure,
      points: Array.from({ length: 100 }, (_, i) => [i * spacing, 0, pressure]),
    },
  });
  expect(pencilInk(line(0.8)).bounds.height).toBeGreaterThan(
    pencilInk(line(12)).bounds.height * 1.2
  );
  expect(pencilInk(line(3, 0.9, false)).bounds.height).toBeGreaterThan(
    pencilInk(line(3, 0.1, false)).bounds.height * 1.2
  );
});

it.each([0.25, 1, 4])(
  'picks the actual ink with 3 screen px tolerance at zoom %s',
  (zoom) => {
    const dot: PencilItem = {
      ...pencil(false),
      geometry: { points: [[0, 0, 0.5]], simulatePressure: false },
      transform: multiply(
        translation(120, 80),
        multiply(rotation(0.7), scaling(2, 0.6))
      ),
    };
    const editor = createGraphicsEditor([dot]);
    editor.zoomAt({ x: 0, y: 0 }, zoom);
    const polygon = pencilInk(dot).outline.map((point) =>
      transformPoint(dot.transform, point)
    );
    const max = polygon.reduce((p, q) => (p.x > q.x ? p : q));
    expect(editor.hitTest({ x: max.x + 2.99 / zoom, y: max.y })).toBe('ink');
    expect(
      editor.hitTest({ x: max.x + 3.01 / zoom, y: max.y })
    ).toBeUndefined();
  }
);

it('uses smoothed ink bounds and leaves empty loops and bounding-box gaps clickable', () => {
  const loop: PencilItem = {
    ...pencil(),
    geometry: {
      simulatePressure: true,
      points: Array.from({ length: 90 }, (_, i) => [
        100 + 80 * Math.cos((i * Math.PI) / 44),
        100 + 80 * Math.sin((i * Math.PI) / 44),
        0.5,
      ]),
    },
  };
  const back = {
    id: 'back',
    type: 'rectangle' as const,
    placement: { parentId: 'scene-root', sortKey: 'a0' },
    transform: IDENTITY,
    geometry: { width: 220, height: 220 },
    appearance: { fill: 'blue', stroke: 'black' },
  };
  const editor = createGraphicsEditor([back, loop]);
  expect(editor.hitTest({ x: 100, y: 100 })).toBe('back');
  const scene = createScene([loop]);
  expect(boxHits(scene, { x: 90, y: 90, width: 20, height: 20 })).toEqual([]);
  expect(boxHits(scene, { x: 0, y: 0, width: 220, height: 220 })).toEqual([
    'ink',
  ]);
  const frame = selectionFrame(scene, ['ink'])!;
  expect(frame.bounds).toEqual(pencilInk(loop).bounds);
  for (const point of pencilInk(loop).outline) {
    expect(point.x).toBeGreaterThanOrEqual(frame.bounds.x);
    expect(point.y).toBeGreaterThanOrEqual(frame.bounds.y);
    expect(point.x).toBeLessThanOrEqual(
      frame.bounds.x + frame.bounds.width + 1e-9
    );
    expect(point.y).toBeLessThanOrEqual(
      frame.bounds.y + frame.bounds.height + 1e-9
    );
  }
  const corner = { x: frame.bounds.x + 1, y: frame.bounds.y + 1 };
  expect(editor.hitTest(corner)).toBe('back');
});

it('resizes samples and regenerates pressure without magnifying the nominal brush', () => {
  const item = pencil();
  const bounds = pencilDefinition.bounds(item);
  const resized = pencilDefinition.resize(item, {
    ...bounds,
    width: bounds.width * 2,
    height: bounds.height,
  });
  expect(resized.geometry.points[40]![0]).toBe(
    item.geometry.points[40]![0] * 2
  );
  expect(resized.geometry.points[40]![1]).toBe(item.geometry.points[40]![1]);
  expect(resized.appearance.strokeWidth).toBe(12);
  expect(resized.geometry.simulatePressure).toBe(true);
  expect(pencilInk(resized).path).not.toBe(pencilInk(item).path);
});

it('supports flip-through-zero and uniform resize inside nested rotated groups', () => {
  const editor = createGraphicsEditor([pencil()]);
  const initial = editor.document;
  editor.select('ink');
  const frame = selectionFrame(editor.document, ['ink'])!;
  editor.beginTransform('ink', frame.corners[1]!, 'e');
  editor.updateTransform({
    x: frame.bounds.x - frame.bounds.width,
    y: frame.corners[1]!.y,
  });
  expect(editor.commitTransform()).toBe(true);
  expect(worldMatrix(editor.document, 'ink')[0]).toBeLessThan(0);
  editor.undo();
  expect(editor.document).toEqual(initial);
  editor.groupSelection('group');
  editor.groupSelection('outer');
  editor.beginTransform('outer', { x: 0, y: -100 }, 'rotate');
  editor.updateTransform({ x: 200, y: 0 });
  editor.commitTransform();
  const before = editor.document;
  const group = selectionFrame(before, ['outer'])!;
  editor.beginTransform('outer', group.corners[2]!, 'se');
  editor.updateTransform(
    {
      x: group.bounds.x + group.bounds.width * 2,
      y: group.bounds.y + group.bounds.height * 2,
    },
    { proportional: true }
  );
  editor.commitTransform();
  const ink = editor.document.items.ink;
  if (ink?.type !== 'pencil') throw new Error('Missing pencil');
  expect(ink.geometry.points[20]![0]).toBeCloseTo(
    pencil().geometry.points[20]![0] * 2
  );
  expect(
    Math.hypot(...worldMatrix(editor.document, 'ink').slice(0, 2))
  ).toBeCloseTo(1);
  expect(ink.appearance.strokeWidth).toBe(12);
  editor.undo();
  expect(editor.document).toEqual(before);
});

it('round-trips pencil data through clipboard with deeply immutable samples', () => {
  const input = pencil();
  const scene = createScene([input]);
  const fragment = parseFragment(JSON.stringify(copyFragment(scene, ['ink'])))!;
  const next = pasteFragment(createScene(), fragment, () => 'copy').document;
  const copy = next.items.copy;
  if (copy?.type !== 'pencil') throw new Error('Missing copied pencil');
  expect(copy.geometry).toEqual(input.geometry);
  expect(Object.isFrozen(copy.geometry.points)).toBe(true);
  expect(Object.isFrozen(copy.geometry.points[0])).toBe(true);
  expect(() => freezeDocument(next)).not.toThrow();
  for (const points of [[], [[NaN, 0, 0.5]], [[0, 0, 2]], [[0, 0]]]) {
    expect(() =>
      createScene([
        {
          ...input,
          geometry: { simulatePressure: true, points },
        } as unknown as PencilItem,
      ])
    ).toThrow();
  }
});

it('syncs finalized pencil strokes and preserves remote styles through local undo', () => {
  const lab = createGraphicsPeerLab(createScene());
  try {
    lab.setConnected(false);
    const a = lab.peers[0]!.editor,
      b = lab.peers[1]!.editor;
    a.beginShape('pencil', { x: 20, y: 30 });
    a.updateDrawing([
      { x: 30, y: 50 },
      { x: 70, y: 80 },
    ]);
    expect(lab.status().pending).toBe(0);
    a.commitShape('ink', appearance);
    lab.syncNow();
    expect(a.document).toEqual(b.document);
    b.select('ink');
    b.setSelectionAppearance({ stroke: 'blue' });
    a.beginTransform('ink', { x: 20, y: 30 });
    a.updateTransform({ x: 40, y: 60 });
    a.commitTransform();
    lab.syncNow();
    a.undo();
    lab.syncNow();
    expect(a.document).toEqual(b.document);
    expect(a.document.items.ink).toMatchObject({
      appearance: { stroke: 'blue' },
      transform: translation(20, 30),
    });
    expect(drawableIds(a.document)).toEqual(['ink']);
  } finally {
    lab.dispose();
  }
});
