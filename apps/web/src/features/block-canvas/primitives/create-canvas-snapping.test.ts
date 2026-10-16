import {
  createGraphicsEditor,
  dotGridLevels,
  IDENTITY,
} from '@macro-inc/graphics';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { canvasSnapUnit } from '../core/snapping';
import { createCanvasSnapping } from './create-canvas-snapping';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()));
function setup() {
  return createRoot((dispose) => {
    const editor = createGraphicsEditor([
      {
        id: 'rect',
        type: 'rectangle',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: IDENTITY,
        geometry: { width: 160, height: 100 },
        appearance: { fill: 'red', stroke: 'black' },
      },
    ]);
    const cancel = vi.fn();
    const snapping = createCanvasSnapping(editor, cancel);
    cleanups.push(() => {
      dispose();
      editor.dispose();
    });
    return { editor, snapping, cancel, dispose };
  });
}

it.each([
  [0.01, 1024],
  [0.125, 64],
  [0.25, 64],
  [0.5, 16],
  [1, 16],
  [1.001, 4],
  [2, 4],
  [4, 4],
  [4.001, 1],
  [8, 1],
])('matches the smallest visible dots at zoom %s', (scale, unit) => {
  expect(canvasSnapUnit('auto', scale, true)).toBe(unit);
  const visible = dotGridLevels(scale).filter((level) => level.opacity > 0);
  expect(unit).toBe(Math.min(...visible.map((level) => level.unit)));
  expect(canvasSnapUnit('none', scale, true)).toBeUndefined();
  expect(canvasSnapUnit('pixel', scale, false)).toBe(1);
  expect(canvasSnapUnit('auto', scale, false)).toBeUndefined();
});

it('defaults to free placement and changes only local policy when choosing a mode', () => {
  const { editor, snapping } = setup();
  const document = editor.document;
  expect(snapping.snapMode()).toBe('none');
  expect(editor.getSnapUnit()).toBeUndefined();
  editor.beginRectangle({ x: 1.25, y: 2.75 });
  editor.updateRectangle({ x: 11.5, y: 23.5 });
  expect(editor.getPreview()).toEqual({
    x: 1.25,
    y: 2.75,
    width: 10.25,
    height: 20.75,
  });
  editor.cancelRectangle();
  snapping.setSnapMode('pixel');
  editor.beginRectangle({ x: 1.25, y: 2.75 });
  editor.updateRectangle({ x: 11.5, y: 23.5 });
  expect(editor.getPreview()).toEqual({ x: 1, y: 3, width: 11, height: 21 });
  editor.cancelRectangle();
  snapping.setSnapMode('none');
  expect(editor.getSnapUnit()).toBeUndefined();
  expect(editor.document).toBe(document);
  expect(editor.getSession().canUndo).toBe(false);
});

it('follows zoom and grid visibility in auto mode while pixel mode stays at one', () => {
  const { editor, snapping } = setup();
  snapping.setSnapMode('auto');
  expect(editor.getSnapUnit()).toBe(16);
  editor.zoomAt({ x: 0, y: 0 }, 2);
  expect(editor.getSnapUnit()).toBe(4);
  editor.zoomAt({ x: 0, y: 0 }, 8);
  expect(editor.getSnapUnit()).toBe(1);
  snapping.setGrid(false);
  editor.zoomAt({ x: 0, y: 0 }, 0.125);
  expect(snapping.snapMode()).toBe('auto');
  expect(editor.getSnapUnit()).toBeUndefined();
  snapping.setGrid(true);
  expect(editor.getSnapUnit()).toBe(64);
  snapping.setSnapMode('pixel');
  snapping.setGrid(false);
  editor.zoomAt({ x: 0, y: 0 }, 8);
  expect(editor.getSnapUnit()).toBe(1);
  snapping.setSnapMode('none');
  editor.zoomAt({ x: 0, y: 0 }, 1);
  expect(editor.getSnapUnit()).toBeUndefined();
});

it('invalidates host previews only when the unit changes, and unsubscribes on disposal', () => {
  const { editor, snapping, cancel, dispose } = setup();
  snapping.setSnapMode('auto');
  cancel.mockClear();
  editor.beginRectangle({ x: 0, y: 0 });
  editor.updateRectangle({ x: 100, y: 100 });
  editor.panBy({ x: 10, y: 20 });
  editor.zoomAt({ x: 0, y: 0 }, 0.8);
  expect(editor.getSnapUnit()).toBe(16);
  expect(cancel).not.toHaveBeenCalled();
  editor.zoomAt({ x: 0, y: 0 }, 2);
  expect(cancel).toHaveBeenCalledOnce();
  expect(editor.getPreview()).toBeUndefined();
  expect(editor.getSession().canUndo).toBe(false);
  dispose();
  editor.zoomAt({ x: 0, y: 0 }, 8);
  expect(editor.getSnapUnit()).toBe(4);
});
