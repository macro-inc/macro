import { afterEach, expect, it, vi } from 'vitest';
import {
  attachCameraControls,
  type GraphicsInputOptions,
} from '../src/browser';
import { createGraphicsEditor, translation } from '../src/core';

// The test DOM has no PointerEvent. Touch navigation creates one, and reads
// these fields from the ones it receives.
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
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
});

function setup(options: GraphicsInputOptions) {
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
  const viewport = document.createElement('div');
  viewport.tabIndex = 0;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  document.body.append(viewport);
  const detach = attachCameraControls(viewport, editor, {
    appearance: () => ({ fill: 'transparent', stroke: 'black' }),
    ...options,
  });
  cleanups.push(() => {
    detach();
    editor.dispose();
    viewport.remove();
  });
  let now = 0;
  type PointerEventType =
    | 'pointerdown'
    | 'pointermove'
    | 'pointerup'
    | 'pointercancel';
  const pointer = (
    pointerType: 'touch' | 'pen',
    id: number,
    type: PointerEventType,
    x: number,
    y: number,
    elapsed: number
  ) => {
    now += elapsed;
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType,
      isPrimary: id === 1,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'timeStamp', { value: now });
    viewport.dispatchEvent(event);
  };
  /** One finger's event; the first finger down is the primary pointer. */
  const finger = (
    id: number,
    type: PointerEventType,
    x: number,
    y: number,
    elapsed = 10
  ) => pointer('touch', id, type, x, y, elapsed);
  const pen = (type: PointerEventType, x: number, y: number) =>
    pointer('pen', 9, type, x, y, 10);
  return { editor, viewport, finger, pen };
}

it('zooms around the midpoint of two fingers and leaves the selection alone', () => {
  const { editor, finger } = setup({ tool: () => 'select' });
  const before = editor.document;

  // The first finger lands on the shape, which selects it and starts a move.
  finger(1, 'pointerdown', 20, 20);
  expect(editor.getSession().selectedIds).toEqual(['shape']);
  finger(2, 'pointerdown', 120, 20);
  expect(editor.getSession().selectedIds).toEqual([]);
  expect(editor.getSession().transform).toBeUndefined();

  // Spread from 100 to 200 px apart around a midpoint that stays at (70, 20).
  finger(1, 'pointermove', -30, 20);
  finger(2, 'pointermove', 170, 20);
  expect(editor.getCamera()).toEqual({ x: -70, y: -20, scale: 2 });

  finger(1, 'pointerup', -30, 20);
  finger(2, 'pointerup', 170, 20);
  expect(editor.document).toBe(before);
  expect(editor.getSession().canUndo).toBe(false);
  expect(editor.getSession().selectedIds).toEqual([]);
});

it('pans with two fingers that move together', () => {
  const { editor, finger } = setup({ tool: () => 'select' });

  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  finger(1, 'pointermove', 230, 260);
  finger(2, 'pointermove', 330, 260);

  expect(editor.getCamera()).toEqual({ x: 30, y: 60, scale: 1 });
});

it.each(['rectangle', 'pencil'] as const)(
  'drops a %s the first finger started',
  (tool) => {
    const { editor, finger } = setup({ tool: () => tool });
    const before = editor.document;

    finger(1, 'pointerdown', 150, 150);
    finger(1, 'pointermove', 180, 190);
    expect(editor.getPreview()).toBeDefined();

    finger(2, 'pointerdown', 260, 150);
    expect(editor.getPreview()).toBeUndefined();
    finger(1, 'pointermove', 140, 190);
    finger(2, 'pointermove', 300, 150);
    finger(2, 'pointerup', 300, 150);
    finger(1, 'pointerup', 140, 190);

    expect(editor.document).toBe(before);
    expect(editor.getSession().canUndo).toBe(false);
    expect(editor.getCamera().scale).not.toBe(1);
  }
);

it('drops a marquee and restores what it had deselected', () => {
  const { editor, finger } = setup({ tool: () => 'select' });
  editor.select('shape');

  finger(1, 'pointerdown', 300, 300);
  finger(1, 'pointermove', 340, 340);
  expect(editor.getSession().box).toBeDefined();
  expect(editor.getSession().selectedIds).toEqual([]);

  finger(2, 'pointerdown', 400, 300);
  expect(editor.getSession().box).toBeUndefined();
  expect(editor.getSession().selectedIds).toEqual(['shape']);
});

it('ignores a finger left behind until every finger has lifted', () => {
  const { editor, finger } = setup({ tool: () => 'rectangle' });
  const before = editor.document;

  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  finger(2, 'pointerup', 300, 200);
  const camera = editor.getCamera();

  // The remaining finger neither draws nor pans.
  finger(1, 'pointermove', 260, 280);
  expect(editor.getPreview()).toBeUndefined();
  expect(editor.getCamera()).toEqual(camera);

  // A second finger landing again resumes from where both now are.
  finger(3, 'pointerdown', 360, 280);
  finger(3, 'pointermove', 380, 300);
  finger(1, 'pointermove', 280, 300);
  expect(editor.getCamera()).toEqual({
    ...camera,
    x: camera.x + 20,
    y: camera.y + 20,
  });

  finger(3, 'pointerup', 380, 300);
  finger(1, 'pointerup', 280, 300, 400);
  expect(editor.document).toBe(before);

  // With every finger up, one finger draws again.
  finger(1, 'pointerdown', 150, 150);
  finger(1, 'pointermove', 220, 230);
  finger(1, 'pointerup', 220, 230);
  expect(editor.document).not.toBe(before);
});

it('glides after a two-finger flick and stops when touched', () => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  const { editor, finger } = setup({ tool: () => 'select' });

  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  for (let step = 1; step <= 5; step++) {
    finger(1, 'pointermove', 200 + step * 20, 200, 8);
    finger(2, 'pointermove', 300 + step * 20, 200, 8);
  }
  finger(1, 'pointerup', 300, 200);
  finger(2, 'pointerup', 400, 200);
  const released = editor.getCamera();
  expect(released.x).toBe(100);

  vi.advanceTimersByTime(100);
  const gliding = editor.getCamera();
  expect(gliding.x).toBeGreaterThan(released.x);
  expect(gliding.y).toBe(released.y);

  finger(1, 'pointerdown', 250, 250);
  vi.advanceTimersByTime(500);
  expect(editor.getCamera()).toEqual(gliding);
});

it('does not glide when the system cancels the fingers mid-flick', () => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  const { editor, finger } = setup({ tool: () => 'select' });

  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  for (let step = 1; step <= 5; step++) {
    finger(1, 'pointermove', 200 + step * 20, 200, 8);
    finger(2, 'pointermove', 300 + step * 20, 200, 8);
  }
  // One finger is taken away; the other lifts normally right after.
  finger(1, 'pointercancel', 0, 0);
  finger(2, 'pointerup', 400, 200);
  const released = editor.getCamera();

  vi.advanceTimersByTime(500);
  expect(editor.getCamera()).toEqual(released);
});

it('does not glide when the fingers rest before lifting', () => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  const { editor, finger } = setup({ tool: () => 'select' });

  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  finger(1, 'pointermove', 300, 200);
  finger(2, 'pointermove', 400, 200);
  finger(1, 'pointerup', 300, 200, 500);
  finger(2, 'pointerup', 400, 200);
  const released = editor.getCamera();

  vi.advanceTimersByTime(500);
  expect(editor.getCamera()).toEqual(released);
});

it('does not zoom twice when WebKit also reports the pinch as a gesture', () => {
  const { editor, viewport, finger } = setup({ tool: () => 'select' });

  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  finger(1, 'pointermove', 150, 200);
  finger(2, 'pointermove', 350, 200);
  expect(editor.getCamera().scale).toBe(2);

  const gesture = new Event('gesturechange', { bubbles: true });
  Object.assign(gesture, { scale: 2, clientX: 250, clientY: 200 });
  viewport.dispatchEvent(gesture);
  expect(editor.getCamera().scale).toBe(2);
});

it('does not fling when the fingers were pinching as they lifted', () => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  const { editor, finger } = setup({ tool: () => 'select' });

  // One finger stays put while the other spreads away from it, fast.
  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 260, 200);
  for (let step = 1; step <= 5; step++)
    finger(2, 'pointermove', 260 + step * 20, 200, 8);
  finger(2, 'pointerup', 360, 200);
  finger(1, 'pointerup', 200, 200);
  const released = editor.getCamera();
  expect(released.scale).toBeGreaterThan(2);

  vi.advanceTimersByTime(500);
  expect(editor.getCamera()).toEqual(released);
});

it('leaves a pen stroke alone when fingers land beside it', () => {
  const { editor, finger, pen } = setup({ tool: () => 'pencil' });
  const before = editor.document;
  const camera = editor.getCamera();

  pen('pointerdown', 150, 150);
  pen('pointermove', 180, 170);
  // A resting palm reads as two touches.
  finger(1, 'pointerdown', 300, 400);
  finger(2, 'pointerdown', 340, 420);
  finger(1, 'pointermove', 320, 430);
  finger(2, 'pointermove', 380, 470);
  expect(editor.getPreview()).toBeDefined();
  expect(editor.getCamera()).toEqual(camera);

  pen('pointermove', 220, 200);
  pen('pointerup', 220, 200);
  expect(editor.document).not.toBe(before);
  expect(Object.keys(editor.document.items)).toHaveLength(3);
});

it('navigates again after a pen whose release was lost to another window', () => {
  const { editor, finger, pen } = setup({ tool: () => 'pencil' });

  // The pen goes down, then the window loses focus and never sees it lift.
  pen('pointerdown', 150, 150);
  window.dispatchEvent(new Event('blur'));

  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  finger(1, 'pointermove', 150, 200);
  finger(2, 'pointermove', 350, 200);
  expect(editor.getCamera().scale).toBe(2);
});

it('leaves a single finger to the tool', () => {
  const { editor, finger } = setup({ tool: () => 'pan' });

  finger(1, 'pointerdown', 100, 100);
  finger(1, 'pointermove', 140, 130);
  finger(1, 'pointerup', 140, 130);

  expect(editor.getCamera()).toEqual({ x: 40, y: 30, scale: 1 });
});
