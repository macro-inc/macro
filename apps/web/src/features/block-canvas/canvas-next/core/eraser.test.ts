import {
  createGraphicsEditor,
  drawableIds,
  groupNodes,
} from '@macro-inc/graphics';
import { expect, it } from 'vitest';
import { eraseCommand, eraserHits } from './eraser';
import { createCanvasNextScene } from './seed-scene';

it('sweeps between events and finds every crossed shape, not just the topmost', () => {
  const scene = createCanvasNextScene();
  expect(eraserHits(scene, { x: 0, y: 200 }, { x: 700, y: 200 }, 6)).toEqual([
    'welcome-rectangle',
    'welcome-ellipse',
  ]);
  expect(eraserHits(scene, { x: 0, y: 0 }, { x: 80, y: 500 }, 6)).toEqual([]);
  // Empty ellipse interiors are not painted; its bounding box is not an eraser hit.
  expect(eraserHits(scene, { x: 490, y: 250 }, { x: 530, y: 250 }, 6)).toEqual(
    []
  );
});
it('erases a touched group as one object', () => {
  const scene = groupNodes(
    createCanvasNextScene(),
    ['welcome-rectangle', 'welcome-small'],
    'group'
  );
  expect(eraserHits(scene, { x: 120, y: 120 }, { x: 150, y: 150 }, 6)).toEqual([
    'group',
  ]);
});
it('undoes and redoes an entire eraser stroke in one step', () => {
  const editor = createGraphicsEditor(createCanvasNextScene());
  editor.execute(eraseCommand, ['welcome-rectangle', 'welcome-ellipse']);
  expect(drawableIds(editor.document)).toEqual(['welcome-small']);
  editor.undo();
  expect(drawableIds(editor.document)).toHaveLength(3);
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  expect(drawableIds(editor.document)).toEqual(['welcome-small']);
  editor.dispose();
});
