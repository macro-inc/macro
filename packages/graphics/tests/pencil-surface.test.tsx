import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  type DrawingKind,
  drawableIds,
} from '../src/core';
import { pencilInk } from '../src/core/shapes/pencil';
import { GraphicsSurface } from '../src/solid';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
function setup() {
  const editor = createGraphicsEditor();
  const host = document.createElement('div');
  document.body.append(host);
  const [tool, setTool] = createSignal<DrawingKind | 'select'>('pencil');
  let count = 0;
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={editor}
        input={{
          tool,
          createId: () => `ink-${++count}`,
          appearance: () => ({ fill: 'red', stroke: 'black', strokeWidth: 12 }),
        }}
      />
    ),
    host
  );
  const viewport = host.querySelector<HTMLElement>(
    '[aria-label="Graphics canvas"]'
  )!;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  cleanups.push(() => {
    dispose();
    editor.dispose();
    host.remove();
  });
  return { host, viewport, editor, setTool };
}
function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  pressure = 0.5,
  coalesced?: { x: number; y: number; pressure: number }[]
) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'pen' },
    pressure: { value: pressure },
    getCoalescedEvents: {
      value: () =>
        (coalesced ?? []).map((p) => ({
          clientX: p.x,
          clientY: p.y,
          pressure: p.pressure,
          pointerType: 'pen',
        })),
    },
  });
  target.dispatchEvent(event);
}

it('captures coalesced pen samples, paints the preview as ink, and releases outside the canvas in one undo', () => {
  const { editor, viewport, host, setTool } = setup();
  const before = editor.document;
  pointer(viewport, 'pointerdown', 100, 120, 0.3);
  pointer(window, 'pointermove', 140, 150, 0.9, [
    { x: 110, y: 125, pressure: 0.4 },
    { x: 130, y: 130, pressure: 0.7 },
    { x: 140, y: 150, pressure: 0.9 },
  ]);
  expect(editor.document).toBe(before);
  const preview = host.querySelector('[data-graphics-preview] path')!;
  expect(preview.getAttribute('fill')).toBe('black');
  const path = preview.getAttribute('d');
  pointer(viewport, 'lostpointercapture', 140, 150);
  pointer(window, 'pointerup', 140, 150, 0);
  const item = editor.document.items['ink-1'];
  if (item?.type !== 'pencil') throw new Error('Missing pencil');
  expect(item.geometry).toEqual({
    simulatePressure: false,
    points: [
      [0, 0, 0.3],
      [10, 5, 0.4],
      [30, 10, 0.7],
      [40, 30, 0.9],
    ],
  });
  expect(host.querySelector('[data-graphics-preview]')).toBeNull();
  const shape = host.querySelector('[data-graphics-item="ink-1"]')!;
  expect(shape.querySelector('path')!.getAttribute('d')).toBe(path);
  setTool('select');
  editor.select('ink-1');
  editor.setSelectionAppearance({ strokeWidth: 24 });
  expect(host.querySelector('[data-graphics-item="ink-1"]')).toBe(shape);
  expect(shape.querySelector('path')!.getAttribute('d')).not.toBe(path);
  const updated = editor.document.items['ink-1'];
  if (updated?.type !== 'pencil') throw new Error('Missing pencil');
  expect(shape.querySelector('path')!.getAttribute('d')).toBe(
    pencilInk(updated).path
  );
  editor.beginTransform('ink-1', { x: 145, y: 155 }, 'se');
  editor.updateTransform({ x: 210, y: 185 });
  const resizedPreview = editor.getSession().transform?.nodes['ink-1'];
  if (resizedPreview?.type !== 'pencil')
    throw new Error('Missing resized pencil');
  const resizedPath = pencilInk(resizedPreview).path;
  expect(shape.querySelector('path')!.getAttribute('d')).toBe(resizedPath);
  editor.commitTransform();
  expect(shape.querySelector('path')!.getAttribute('d')).toBe(resizedPath);
  editor.undo(); // resize
  editor.undo(); // style
  editor.undo(); // draw
  expect(editor.document).toEqual(before);
  editor.redo();
  expect(drawableIds(editor.document)).toEqual(['ink-1']);
});

it('cancels pending ink on Escape and pointercancel and draws a tap as a dot', () => {
  const { editor, viewport, host } = setup();
  pointer(viewport, 'pointerdown', 100, 100);
  pointer(window, 'pointermove', 150, 160);
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  );
  pointer(window, 'pointerup', 150, 160);
  expect(drawableIds(editor.document)).toEqual([]);
  pointer(viewport, 'pointerdown', 100, 100);
  pointer(window, 'pointercancel', 100, 100);
  expect(host.querySelector('[data-graphics-preview]')).toBeNull();
  pointer(viewport, 'pointerdown', 100, 100);
  pointer(window, 'pointerup', 100, 100);
  expect(drawableIds(editor.document)).toHaveLength(1);
  expect(
    host.querySelector('[data-graphics-item] path')!.getAttribute('d')
  ).toContain('Z');
});
