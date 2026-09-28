import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createGraphicsEditor,
  type GraphicsItem,
  translation,
} from '../src/core';
import { GraphicsSurface } from '../src/solid';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
function setup(grouped = false) {
  const shapes: GraphicsItem[] = ['back', 'front'].map((id, i) => ({
    id,
    type: 'rectangle',
    placement: { parentId: grouped ? 'group' : 'scene-root', sortKey: `a${i}` },
    transform: translation(0, 0),
    geometry: { width: 100, height: 100 },
    appearance: {
      fill: id === 'back' ? 'red' : 'transparent',
      stroke: 'black',
    },
  }));
  if (grouped)
    shapes.unshift({
      id: 'group',
      type: 'group',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
    });
  const editor = createGraphicsEditor(shapes);
  const host = document.createElement('div');
  document.body.append(host);
  const [tool, setTool] = createSignal<'select' | 'pan' | 'pencil'>('select');
  const dispose = render(
    () => (
      <GraphicsSurface
        editor={editor}
        input={{ tool, duplicateOnAltDrag: true }}
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
  const hovered = () =>
    [...host.querySelectorAll('[data-graphics-hover-outline]')].map((node) =>
      node.getAttribute('data-graphics-hover-outline')
    );
  function pointer(
    type: string,
    x: number,
    y: number,
    init: MouseEventInit = {}
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      ...init,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: 'mouse' },
    });
    viewport.dispatchEvent(event);
  }
  return { editor, host, viewport, pointer, hovered, setTool };
}

it('highlights the click-through target and preserves the same screen tolerance while zooming', () => {
  const { editor, pointer, hovered } = setup();
  pointer('pointermove', 50, 50);
  expect(hovered()).toEqual(['back']);
  expect(editor.getSession().selectedIds).toEqual([]);
  pointer('pointermove', -2.9, 50);
  expect(hovered()).toEqual(['front']);
  pointer('pointermove', -3.1, 50);
  expect(hovered()).toEqual([]);
  editor.zoomAt({ x: 0, y: 0 }, 4);
  pointer('pointermove', -2.9, 50);
  expect(hovered()).toEqual(['front']);
  pointer('pointerdown', -2.9, 50);
  expect(editor.getSession().selectedIds).toEqual(['front']);
  expect(hovered()).toEqual([]);
  pointer('pointerup', -2.9, 50);
  pointer('pointermove', 200, 200);
  // The selected empty rectangle's box now moves that selection instead of picking through.
  expect(hovered()).toEqual([]);
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true })
  );
  expect(hovered()).toEqual(['back']);
  pointer('pointerdown', 200, 200, { shiftKey: true });
  pointer('pointerup', 200, 200, { shiftKey: true });
  expect(editor.getSession().selectedIds).toEqual(['front', 'back']);
});

it('updates grouped/deep targets without pointer movement and clears for tools, pan, leave and blur', () => {
  const { viewport, pointer, hovered, setTool } = setup(true);
  pointer('pointermove', 50, 50);
  expect(hovered()).toEqual(['back', 'front']);
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Meta', metaKey: true })
  );
  expect(hovered()).toEqual(['back']);
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
  expect(hovered()).toEqual(['back', 'front']);
  setTool('pencil');
  expect(hovered()).toEqual([]);
  setTool('select');
  expect(hovered()).toEqual(['back', 'front']);
  viewport.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
  );
  expect(hovered()).toEqual([]);
  viewport.dispatchEvent(
    new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true })
  );
  expect(hovered()).toEqual(['back', 'front']);
  pointer('pointerleave', 200, 200);
  expect(hovered()).toEqual([]);
  pointer('pointermove', 50, 50);
  window.dispatchEvent(new Event('blur'));
  expect(hovered()).toEqual([]);
});

it('repicks under a stationary pointer after camera or document changes without recording hover in history', () => {
  const { editor, pointer, hovered } = setup();
  pointer('pointermove', 50, 50);
  expect(hovered()).toEqual(['back']);
  editor.panBy({ x: 200, y: 0 });
  expect(hovered()).toEqual([]);
  editor.panBy({ x: -200, y: 0 });
  expect(hovered()).toEqual(['back']);
  expect(editor.getSession().canUndo).toBe(false);
  editor.resetDocument({
    rootId: 'scene-root',
    items: { 'scene-root': { id: 'scene-root', type: 'surface' } },
  });
  expect(hovered()).toEqual([]);
});
