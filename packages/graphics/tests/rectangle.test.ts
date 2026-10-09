import { expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  fitImageCamera,
  screenToWorld,
} from '../src/core';
import { drawableIds, worldBounds } from '../src/core/scene';

const appearance = { fill: 'transparent', stroke: '#e53935' };

it('keeps reversed drags in image coordinates and commits exactly one change', () => {
  const editor = createGraphicsEditor();
  editor.setImageSurface({ id: 'image', width: 800, height: 600 });
  editor.fitImage({ width: 448, height: 348 });
  const changed = vi.fn();
  editor.subscribeDocument(changed);
  const camera = editor.getCamera();
  editor.beginRectangle(screenToWorld(camera, { x: 224, y: 174 }));
  editor.updateRectangle(screenToWorld(camera, { x: 74, y: 74 }));
  expect(editor.getPreview()).toEqual({
    x: 100,
    y: 100,
    width: 300,
    height: 200,
  });
  expect(drawableIds(editor.document)).toHaveLength(0);
  expect(changed).not.toHaveBeenCalled();
  expect(editor.commitRectangle('rect', appearance)).toBe(true);
  expect(worldBounds(editor.document, 'rect')).toEqual({
    x: 100,
    y: 100,
    width: 300,
    height: 200,
  });
  expect(changed).toHaveBeenCalledTimes(1);
  editor.panBy({ x: 100, y: -200 });
  editor.zoomAt({ x: 100, y: 100 }, 2);
  expect(worldBounds(editor.document, 'rect').x).toBe(100);
});

it('rejects starts outside the image, clips ends and drops cancelled or tiny rectangles', () => {
  const editor = createGraphicsEditor();
  editor.setImageSurface({ id: 'image', width: 100, height: 80 });
  expect(editor.beginRectangle({ x: -1, y: 0 })).toBe(false);
  editor.beginRectangle({ x: 50, y: 50 });
  editor.updateRectangle({ x: 200, y: 200 });
  expect(editor.getPreview()).toEqual({ x: 50, y: 50, width: 50, height: 30 });
  editor.cancelRectangle();
  expect(editor.commitRectangle('cancelled', appearance)).toBe(false);
  editor.beginRectangle({ x: 50, y: 50 });
  editor.updateRectangle({ x: 51, y: 51 });
  expect(editor.commitRectangle('tiny', appearance, 3)).toBe(false);
  expect(drawableIds(editor.document)).toHaveLength(0);
});

it('clears previews and annotations when replacing the image', () => {
  const editor = createGraphicsEditor();
  editor.setImageSurface({ id: 'first', width: 100, height: 80 });
  editor.beginRectangle({ x: 10, y: 10 });
  editor.updateRectangle({ x: 60, y: 60 });
  editor.commitRectangle('one', appearance);
  editor.beginRectangle({ x: 20, y: 20 });
  editor.setImageSurface({ id: 'second', width: 200, height: 100 });
  expect(drawableIds(editor.document)).toHaveLength(0);
  expect(editor.getPreview()).toBeUndefined();
  expect(editor.document.surface?.id).toBe('second');
});

it('fits large images and preserves their aspect ratio in narrow viewports', () => {
  const camera = fitImageCamera(
    { width: 4000, height: 3000 },
    { width: 300, height: 200 }
  );
  expect(camera.scale * 4000).toBeLessThan(300);
  expect(camera.scale * 3000).toBeLessThan(200);
  expect(camera.x).toBeGreaterThan(0);
  expect(camera.y).toBeGreaterThan(0);
});
