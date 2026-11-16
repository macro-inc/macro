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

/** A filled 200 x 100 rectangle at (100, 100) and an unfilled one below it. */
function setup() {
  const editor = createGraphicsEditor([
    {
      id: 'filled',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: translation(100, 100),
      geometry: { width: 200, height: 100 },
      appearance: { fill: 'white', stroke: 'black', strokeWidth: 2 },
    },
    {
      id: 'outline',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a1' },
      transform: translation(100, 400),
      geometry: { width: 200, height: 100 },
      appearance: { fill: 'transparent', stroke: 'black', strokeWidth: 2 },
    },
  ]);
  const viewport = document.createElement('div');
  viewport.tabIndex = 0;
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  document.body.append(viewport);
  const detach = attachCameraControls(viewport, editor, {
    tool: () => 'select',
    touchHandles: true,
  });
  cleanups.push(() => {
    detach();
    editor.dispose();
    viewport.remove();
  });
  const pointer = (
    pointerType: 'touch' | 'mouse',
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    x: number,
    y: number
  ) =>
    viewport.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType,
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      })
    );
  const size = (id: 'filled' | 'outline') => {
    const item = editor.document.items[id];
    if (item?.type !== 'rectangle') throw new Error(`${id} is not a rectangle`);
    return item.geometry;
  };
  return { editor, pointer, size };
}

it('resizes when a finger starts a drag 12px outside a corner', () => {
  const { editor, pointer, size } = setup();
  editor.select('filled');

  // The south-east corner is at (300, 200).
  pointer('touch', 'pointerdown', 309, 208);
  expect(editor.getSession().transform?.handle).toBe('se');
  pointer('touch', 'pointermove', 349, 238);
  pointer('touch', 'pointerup', 349, 238);

  expect(size('filled')).toMatchObject({ width: 240, height: 130 });
});

it('rotates when a finger starts a drag 12px from the rotation knob', () => {
  const { editor, pointer } = setup();
  editor.select('filled');

  // The knob stands 32px above the middle of the top edge: (200, 68).
  pointer('touch', 'pointerdown', 208, 60);

  expect(editor.getSession().transform?.kind).toBe('rotate');
});

it('still moves the shape when a finger drags its middle', () => {
  const { editor, pointer, size } = setup();
  editor.select('filled');

  pointer('touch', 'pointerdown', 200, 150);
  expect(editor.getSession().transform?.kind).toBe('move');
  pointer('touch', 'pointermove', 230, 170);
  pointer('touch', 'pointerup', 230, 170);

  expect(size('filled')).toMatchObject({ width: 200, height: 100 });
});

it('selects an outlined shape when a finger taps 8px from its stroke', () => {
  const { editor, pointer } = setup();

  // 8px inside the unfilled rectangle's left edge, far from its other edges.
  pointer('touch', 'pointerdown', 108, 450);
  pointer('touch', 'pointerup', 108, 450);

  expect(editor.getSession().selectedIds).toEqual(['outline']);
});

it('keeps a cursor to the drawn handles and the painted stroke', () => {
  const { editor, pointer } = setup();
  editor.select('filled');

  // 12px outside the corner is empty canvas to a mouse: a marquee begins.
  pointer('mouse', 'pointerdown', 309, 208);
  expect(editor.getSession().transform).toBeUndefined();
  expect(editor.getSession().box).toBeDefined();
  pointer('mouse', 'pointerup', 309, 208);

  // And 8px from a stroke misses the outlined shape.
  pointer('mouse', 'pointerdown', 108, 450);
  pointer('mouse', 'pointerup', 108, 450);
  expect(editor.getSession().selectedIds).toEqual([]);
});
