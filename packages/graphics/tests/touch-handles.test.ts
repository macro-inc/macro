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

type Rectangle = { id: string; x: number; y: number; fill?: string };

const rectangle = (
  { id, x, y, fill = 'white' }: Rectangle,
  width: number,
  height: number,
  sortKey: string
) => ({
  id,
  type: 'rectangle' as const,
  placement: { parentId: 'scene-root', sortKey },
  transform: translation(x, y),
  geometry: { width, height },
  appearance: { fill, stroke: 'black', strokeWidth: 2 },
});

/**
 * A filled 200 x 100 rectangle at (100, 100) and an unfilled one below it,
 * under any `above` them.
 */
function setup(above: readonly ReturnType<typeof rectangle>[] = []) {
  const editor = createGraphicsEditor([
    rectangle({ id: 'filled', x: 100, y: 100 }, 200, 100, 'a0'),
    rectangle(
      { id: 'outline', x: 100, y: 400, fill: 'transparent' },
      200,
      100,
      'a1'
    ),
    ...above,
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
    y: number,
    target: Element = viewport
  ) =>
    target.dispatchEvent(
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
  const size = (id: string) => {
    const item = editor.document.items[id];
    if (item?.type !== 'rectangle') throw new Error(`${id} is not a rectangle`);
    return item.geometry;
  };
  /** A handle as the renderer draws one: an element the press can land on. */
  const drawnHandle = (handle: string) => {
    const element = document.createElement('div');
    element.dataset.graphicsHandle = handle;
    viewport.append(element);
    return element;
  };
  return { editor, pointer, size, drawnHandle };
}

it('resizes when a finger drags from 12px outside a corner', () => {
  const { editor, pointer, size } = setup();
  editor.select('filled');

  // The south-east corner is at (300, 200).
  pointer('touch', 'pointerdown', 309, 208);
  pointer('touch', 'pointermove', 349, 238);
  expect(editor.getSession().transform?.handle).toBe('se');
  pointer('touch', 'pointerup', 349, 238);

  expect(size('filled')).toMatchObject({ width: 240, height: 130 });
});

it('rotates when a finger drags from 12px off the rotation knob', () => {
  const { editor, pointer } = setup();
  editor.select('filled');

  // The knob stands 32px above the middle of the top edge: (200, 68).
  pointer('touch', 'pointerdown', 208, 60);
  pointer('touch', 'pointermove', 238, 70);

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

it('takes the corner when the finger also covers the strip drawn along an edge', () => {
  const { editor, pointer, drawnHandle } = setup();
  editor.select('filled');

  // On the east edge's strip, 8px above the south-east corner.
  const strip = drawnHandle('e');
  pointer('touch', 'pointerdown', 300, 192, strip);
  pointer('touch', 'pointermove', 320, 212);

  expect(editor.getSession().transform?.handle).toBe('se');
});

it('moves a thin shape from its middle, under the strips drawn along its edges', () => {
  // 8px tall: the strip drawn along each long edge covers the whole shape.
  const { editor, pointer, size, drawnHandle } = setup([
    rectangle({ id: 'thin', x: 100, y: 250 }, 200, 8, 'a2'),
  ]);
  editor.select('thin');

  const strip = drawnHandle('n');
  pointer('touch', 'pointerdown', 200, 254, strip);
  pointer('touch', 'pointermove', 230, 274);
  expect(editor.getSession().transform?.kind).toBe('move');
  pointer('touch', 'pointerup', 230, 274);
  expect(size('thin')).toMatchObject({ width: 200, height: 8 });

  // A cursor on the same strip resizes, as it always has.
  pointer('mouse', 'pointerdown', 200, 254, strip);
  pointer('mouse', 'pointermove', 200, 244);
  expect(editor.getSession().transform?.handle).toBe('n');
  pointer('mouse', 'pointerup', 200, 244);
});

it('gives a finger the handle it lands on, even over a neighbour', () => {
  // A shape painted where the rotation knob stands, 32px above the top edge.
  const { editor, pointer, drawnHandle } = setup([
    rectangle({ id: 'neighbour', x: 170, y: 40 }, 60, 50, 'a2'),
  ]);
  editor.select('filled');

  const knob = drawnHandle('rotate');
  pointer('touch', 'pointerdown', 200, 68, knob);
  pointer('touch', 'pointermove', 230, 78);

  expect(editor.getSession().transform?.kind).toBe('rotate');
  expect(editor.getSession().selectedIds).toEqual(['filled']);
});

it('changes nothing when a finger only taps beside the selection, and deselects', () => {
  const { editor, pointer, size } = setup();
  editor.select('filled');

  pointer('touch', 'pointerdown', 309, 208);
  pointer('touch', 'pointerup', 309, 208);

  expect(size('filled')).toMatchObject({ width: 200, height: 100 });
  expect(editor.getSession().canUndo).toBe(false);
  expect(editor.getSession().selectedIds).toEqual([]);
});

it('leaves a press on another shape to that shape, however near the handles', () => {
  // 6px to the right of the filled rectangle, inside its east edge's reach.
  const { editor, pointer, size } = setup([
    rectangle({ id: 'neighbour', x: 306, y: 120 }, 60, 60, 'a2'),
  ]);
  editor.select('filled');

  pointer('touch', 'pointerdown', 310, 150);
  pointer('touch', 'pointermove', 330, 150);
  pointer('touch', 'pointerup', 330, 150);

  expect(editor.getSession().selectedIds).toEqual(['neighbour']);
  expect(size('filled')).toMatchObject({ width: 200, height: 100 });
});

it('selects an outlined shape when a finger taps 8px from its stroke', () => {
  const { editor, pointer } = setup();

  // 8px inside the unfilled rectangle's left edge, far from its other edges.
  pointer('touch', 'pointerdown', 108, 450);
  pointer('touch', 'pointerup', 108, 450);

  expect(editor.getSession().selectedIds).toEqual(['outline']);
});

it('picks the shape under the finger over a stroke that is merely near', () => {
  // An unfilled frame drawn above the filled rectangle, its left stroke at 150.
  const { editor, pointer } = setup([
    rectangle(
      { id: 'frame', x: 150, y: 120, fill: 'transparent' },
      300,
      200,
      'a2'
    ),
  ]);

  // On the filled rectangle, 8px from the frame's stroke.
  pointer('touch', 'pointerdown', 158, 150);
  pointer('touch', 'pointerup', 158, 150);

  expect(editor.getSession().selectedIds).toEqual(['filled']);
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
