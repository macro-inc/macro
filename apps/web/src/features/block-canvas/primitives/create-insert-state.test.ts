import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createCanvasInsertState } from './create-insert-state';

function viewport() {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => new DOMRect(100, 50, 800, 600);
  return element;
}
function pointer(element: HTMLElement, x: number, y: number) {
  element.dispatchEvent(
    new MouseEvent('pointermove', { clientX: x, clientY: y })
  );
}

describe('canvas insertion location', () => {
  it('captures the pointer in world coordinates and keeps it fixed while the menu is open', () =>
    createRoot((dispose) => {
      let camera = { x: 20, y: -10, scale: 2 };
      const state = createCanvasInsertState(() => camera);
      const element = viewport();
      const detach = state.attach(element);
      pointer(element, 320, 230);
      state.open();
      expect(state.location()).toEqual({
        screen: { x: 320, y: 230 },
        world: { x: 100, y: 95 },
      });
      pointer(element, 700, 500);
      camera = { x: 0, y: 0, scale: 1 };
      state.open();
      expect(state.location()?.world).toEqual({ x: 100, y: 95 });
      state.close();
      state.open();
      expect(state.location()?.world).toEqual({ x: 600, y: 450 });
      detach();
      dispose();
    }));

  it('falls back to the viewport center before a pointer arrives and after it leaves', () =>
    createRoot((dispose) => {
      const state = createCanvasInsertState(() => ({ x: 0, y: 0, scale: 1 }));
      const element = viewport();
      const detach = state.attach(element);
      state.open();
      expect(state.location()).toEqual({
        screen: { x: 500, y: 350 },
        world: { x: 400, y: 300 },
      });
      state.close();
      pointer(element, 250, 250);
      element.dispatchEvent(new Event('pointerleave'));
      state.open();
      expect(state.location()?.screen).toEqual({ x: 500, y: 350 });
      state.close();
      detach();
      state.open();
      expect(state.location()).toBeUndefined();
      dispose();
    }));
  it('anchors the toolbar dropdown to its button while inserting at the canvas center', () =>
    createRoot((dispose) => {
      const state = createCanvasInsertState(() => ({
        x: 20,
        y: -10,
        scale: 2,
      }));
      const element = viewport();
      const detach = state.attach(element);
      pointer(element, 250, 200);
      state.openFromToolbar({ x: 700, y: 620 });
      expect(state.location()).toEqual({
        screen: { x: 700, y: 620 },
        world: { x: 190, y: 155 },
        presentation: 'dropdown',
      });
      state.open();
      expect(state.location()?.presentation).toBe('dropdown');
      state.close();
      state.open();
      expect(state.location()?.presentation).toBeUndefined();
      detach();
      dispose();
    }));
});
