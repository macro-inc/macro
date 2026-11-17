import { afterEach, expect, it, vi } from 'vitest';
import { attachCameraControls } from '../src/browser';
import { createGraphicsEditor, translation } from '../src/core';

// The test DOM has no PointerEvent; the camera controls read these fields.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
    this.isPrimary = init.isPrimary ?? false;
  }
}
vi.stubGlobal('PointerEvent', TestPointerEvent);

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

/** A read-only surface in a document, with one shape at the origin. */
function setup() {
  const editor = createGraphicsEditor([
    {
      id: 'shape',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(0, 0),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'white', stroke: 'black' },
    },
  ]);
  const surface = document.createElement('div');
  surface.tabIndex = 0;
  surface.setPointerCapture = vi.fn();
  surface.hasPointerCapture = () => false;
  document.body.append(surface);
  let yielding = true;
  const detach = attachCameraControls(surface, editor, {
    editing: false,
    tool: () => 'pan',
    yieldToPage: () => yielding,
  });
  cleanups.push(() => {
    detach();
    editor.dispose();
    surface.remove();
  });
  const finger = (id: number, type: string, x: number, y: number) =>
    surface.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType: 'touch',
        isPrimary: id === 1,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      })
    );
  const wheel = (init: WheelEventInit) => {
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
      ...init,
    });
    surface.dispatchEvent(event);
    return event;
  };
  /** The browser's verdict on a touchmove: true when the page may scroll. */
  const pageMayScroll = () => {
    const event = new Event('touchmove', { bubbles: true, cancelable: true });
    surface.dispatchEvent(event);
    return !event.defaultPrevented;
  };
  return {
    editor,
    finger,
    wheel,
    pageMayScroll,
    interact: () => {
      yielding = false;
    },
  };
}

it('leaves one finger to the page: nothing pans, nothing is selected', () => {
  const { editor, finger, pageMayScroll } = setup();
  const camera = editor.getCamera();

  finger(1, 'pointerdown', 50, 40);
  finger(1, 'pointermove', 50, 140);
  expect(pageMayScroll()).toBe(true);
  finger(1, 'pointerup', 50, 140);

  expect(editor.getCamera()).toEqual(camera);
  expect(editor.getSession().selectedIds).toEqual([]);
});

it('still gives two fingers to the canvas, and keeps the page from scrolling under them', () => {
  const { editor, finger, pageMayScroll } = setup();

  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  finger(1, 'pointermove', 150, 200);
  finger(2, 'pointermove', 350, 200);

  expect(editor.getCamera().scale).toBe(2);
  expect(pageMayScroll()).toBe(false);
});

it('leaves the wheel to the page, except for a pinch or a held zoom key', () => {
  const { editor, wheel } = setup();
  const camera = editor.getCamera();

  expect(wheel({}).defaultPrevented).toBe(false);
  expect(editor.getCamera()).toEqual(camera);

  // A trackpad pinch arrives as a wheel with the control key set.
  expect(wheel({ ctrlKey: true }).defaultPrevented).toBe(true);
  expect(editor.getCamera().scale).toBeLessThan(camera.scale);
});

it('takes one finger and the wheel once the person interacts', () => {
  const { editor, finger, wheel, interact } = setup();
  interact();

  finger(1, 'pointerdown', 50, 40);
  finger(1, 'pointermove', 50, 140);
  finger(1, 'pointerup', 50, 140);
  expect(editor.getCamera()).toMatchObject({ x: 0, y: 100 });

  expect(wheel({}).defaultPrevented).toBe(true);
});
