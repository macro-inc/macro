import { expect, it } from 'vitest';
import {
  createGraphicsEditor,
  createScene,
  multiply,
  rotation,
  scaling,
  transformPoint,
  translation,
  worldMatrix,
} from '../src/core';

it('clicks through unfilled interiors and picks outlines with round corner tolerance', () => {
  const editor = createGraphicsEditor(
    ['back', 'front'].map((id, index) => ({
      id,
      type: 'rectangle' as const,
      placement: { parentId: 'scene-root', sortKey: `a${index}` },
      transform: translation(0, 0),
      geometry: { width: 100, height: 100 },
      appearance: {
        fill: id === 'front' ? 'transparent' : 'red',
        stroke: 'black',
      },
    }))
  );
  expect(editor.hitTest({ x: 50, y: 50 })).toBe('back');
  expect(editor.hitTest({ x: 2, y: 50 })).toBe('front');
  expect(editor.hitTest({ x: -3, y: 50 })).toBe('front');
  expect(editor.hitTest({ x: -3.1, y: 50 })).toBeUndefined();
  expect(editor.hitTest({ x: -2, y: -2 })).toBe('front');
  expect(editor.hitTest({ x: -2.2, y: -2.2 })).toBeUndefined();
});
it.each([
  0.25, 1, 4,
])('keeps a 3px tolerance at zoom %s through nested transforms', (zoom) => {
  const scene = createScene([
    {
      id: 'g',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: multiply(
        translation(100, 80),
        multiply(rotation(0.4), scaling(2, 0.7))
      ),
    },
    {
      id: 'r',
      type: 'rectangle',
      placement: { parentId: 'g', sortKey: 'a0' },
      transform: rotation(-0.6),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'transparent', stroke: 'black', strokeWidth: 0.1 },
    },
  ]);
  const editor = createGraphicsEditor(scene);
  editor.zoomAt({ x: 0, y: 0 }, zoom);
  const matrix = worldMatrix(scene, 'r');
  const midpoint = transformPoint(matrix, { x: 50, y: 0 });
  const length = Math.hypot(matrix[0], matrix[1]);
  const nearEdge = (pixels: number) => ({
    x: midpoint.x - ((matrix[1] / length) * pixels) / zoom,
    y: midpoint.y + ((matrix[0] / length) * pixels) / zoom,
  });
  for (const direction of [-1, 1]) {
    expect(editor.hitTest(nearEdge(direction * 2.99))).toBe('g');
    expect(editor.hitTest(nearEdge(direction * 2.99), true)).toBe('r');
    expect(editor.hitTest(nearEdge(direction * 3.01))).toBeUndefined();
  }
  expect(
    editor.hitTest(transformPoint(matrix, { x: 50, y: 50 }))
  ).toBeUndefined();
});
