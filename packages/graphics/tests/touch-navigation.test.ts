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

// Two fingers move the camera once per animation frame. A test runs the frame
// itself, after each move, so the next line sees where the camera went. (Tests
// that fake the timers get theirs instead; a lift applies what is pending.)
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  frames.set(++nextFrame, callback);
  return nextFrame;
});
vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
const runFrame = () => {
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(performance.now());
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  frames.clear();
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
  // Events that arrive between two frames: the frame runs once, after them.
  let batching = false;
  const sameFrame = (events: () => void) => {
    batching = true;
    events();
    batching = false;
    runFrame();
  };
  type PointerEventType =
    | 'pointerdown'
    | 'pointermove'
    | 'pointerup'
    | 'pointercancel';
  const pointer = (
    pointerType: 'touch' | 'pen' | 'mouse',
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
    if (batching) return;
    runFrame();
    // With the timers faked, the frame after a move is theirs to run.
    if (type === 'pointermove' && vi.isFakeTimers())
      vi.advanceTimersToNextFrame();
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
  const mouse = (type: PointerEventType, x: number, y: number) =>
    pointer('mouse', 8, type, x, y, 10);
  // What a host's tool listening on the surface hears, as the connector and
  // eraser do: each event's type and pointer type.
  const heard: string[] = [];
  for (const type of [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
  ])
    viewport.addEventListener(type, (event) =>
      heard.push(
        `${type} ${event instanceof PointerEvent ? event.pointerType : ''}`
      )
    );
  return { editor, viewport, finger, pen, mouse, heard, detach, sameFrame };
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

it('keeps what the pair moved when a third finger lifts before the frame', () => {
  const { editor, finger, sameFrame } = setup({ tool: () => 'select' });

  finger(1, 'pointerdown', 100, 100);
  finger(2, 'pointerdown', 200, 100);
  finger(3, 'pointerdown', 300, 300);
  const camera = editor.getCamera();

  // The pair's move waits for the next frame. A finger that is not of the
  // pair lifting meanwhile must not take that frame away.
  sameFrame(() => {
    finger(1, 'pointermove', 100, 140);
    finger(2, 'pointermove', 200, 140);
    finger(3, 'pointerup', 300, 300);
  });

  expect(editor.getCamera()).toEqual({ ...camera, y: camera.y + 40 });
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

it('pans with one finger where the host says fingers do not draw', () => {
  const { editor, finger, heard } = setup({
    tool: () => 'rectangle',
    fingerPans: () => true,
  });
  const before = editor.document;

  // The pan starts where the finger has shown it is moving, not where it
  // landed, so the canvas does not jump by that first stretch.
  finger(1, 'pointerdown', 150, 150);
  finger(1, 'pointermove', 170, 150);
  expect(editor.getCamera()).toEqual({ x: 0, y: 0, scale: 1 });
  finger(1, 'pointermove', 210, 180);
  expect(editor.getPreview()).toBeUndefined();
  expect(editor.getCamera()).toEqual({ x: 40, y: 30, scale: 1 });

  // A second finger makes it a pinch, from where both now are: spread from
  // 100 to 200px around (260, 180), which keeps the point under it there.
  // The first finger no longer pans on its own.
  finger(2, 'pointerdown', 310, 180);
  finger(1, 'pointermove', 160, 180);
  finger(2, 'pointermove', 360, 180);
  const pinched = editor.getCamera();
  expect(pinched.scale).toBe(2);
  expect(pinched.x).toBeCloseTo(260 - (260 - 40) * 2);
  expect(pinched.y).toBeCloseTo(180 - (180 - 30) * 2);

  finger(2, 'pointerup', 360, 180);
  finger(1, 'pointerup', 160, 180, 400);
  expect(editor.document).toBe(before);
  expect(editor.getSession().canUndo).toBe(false);
  // No tool heard of any of it.
  expect(heard).toEqual([]);
});

it('glides when the one panning finger flicks, and not when it rests first', () => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  const { editor, finger } = setup({
    tool: () => 'pencil',
    fingerPans: () => true,
  });
  const flick = () => {
    finger(1, 'pointerdown', 200, 200);
    for (let step = 1; step <= 5; step++)
      finger(1, 'pointermove', 200 + step * 20, 200, 8);
  };

  flick();
  finger(1, 'pointerup', 300, 200);
  const released = editor.getCamera();
  expect(released.x).toBe(80);
  vi.advanceTimersByTime(500);
  const glided = editor.getCamera();
  expect(glided.x).toBeGreaterThan(released.x);

  // The same moves, then two seconds without one before the lift.
  flick();
  finger(1, 'pointerup', 300, 200, 2000);
  const rested = editor.getCamera();
  vi.advanceTimersByTime(500);
  expect(editor.getCamera()).toEqual(rested);

  // The same moves, then the system takes the finger away.
  flick();
  finger(1, 'pointercancel', 300, 200);
  const cancelled = editor.getCamera();
  vi.advanceTimersByTime(500);
  expect(editor.getCamera()).toEqual(cancelled);
});

it('glides nothing after a tap, even one straight after a two-finger flick', () => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  const { editor, finger } = setup({
    tool: () => 'pencil',
    fingerPans: () => true,
  });
  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 300, 200);
  for (let step = 1; step <= 5; step++) {
    finger(1, 'pointermove', 200 + step * 20, 200, 8);
    finger(2, 'pointermove', 300 + step * 20, 200, 8);
  }
  finger(1, 'pointerup', 300, 200);
  finger(2, 'pointerup', 400, 200);

  // A finger lands at once, which stops the glide, and wobbles before it
  // lifts. It never moved far enough to pan, so it has nothing to fling.
  finger(1, 'pointerdown', 250, 300, 20);
  const tapped = editor.getCamera();
  finger(1, 'pointermove', 253, 302, 16);
  finger(1, 'pointermove', 256, 304, 16);
  finger(1, 'pointerup', 256, 304, 16);
  vi.advanceTimersByTime(500);
  expect(editor.getCamera()).toEqual(tapped);
});

it('gives the surface to a pen that lands while a finger is drawing', () => {
  const { editor, finger, pen } = setup({ tool: () => 'rectangle' });

  // The hand holding the pen touches down first and starts a shape.
  finger(1, 'pointerdown', 150, 150);
  finger(1, 'pointermove', 180, 190);
  expect(editor.getPreview()).toBeDefined();

  // The pen takes over: the hand's shape is void and the pen draws its own.
  pen('pointerdown', 300, 300);
  pen('pointermove', 360, 350);
  finger(1, 'pointermove', 200, 220);
  pen('pointerup', 360, 350);
  finger(1, 'pointerup', 200, 220);

  const drawn = Object.values(editor.document.items).flatMap((item) =>
    item.type === 'rectangle' && item.id !== 'shape' ? [item.geometry] : []
  );
  expect(drawn).toEqual([expect.objectContaining({ width: 60, height: 50 })]);
});

it('leaves the canvas still under a hand that only settles, and stops a pan when the pen lands', () => {
  const { editor, finger, pen } = setup({
    tool: () => 'pencil',
    fingerPans: () => true,
  });
  const camera = editor.getCamera();

  // The hand shifts a little as it comes to rest, never 10px from where it
  // landed: not a pan.
  finger(1, 'pointerdown', 300, 400);
  finger(1, 'pointermove', 306, 405);
  finger(1, 'pointermove', 303, 409);
  expect(editor.getCamera()).toEqual(camera);

  // The pen draws, and the hand does nothing while it rests or after.
  pen('pointerdown', 150, 150);
  pen('pointermove', 200, 180);
  finger(1, 'pointermove', 340, 440);
  pen('pointerup', 200, 180);
  finger(1, 'pointermove', 360, 460);
  finger(1, 'pointerup', 360, 460);
  expect(editor.getCamera()).toEqual(camera);
  expect(Object.keys(editor.document.items)).toHaveLength(3);

  // A finger that was really panning is stopped where it is, not put back.
  finger(1, 'pointerdown', 300, 400);
  finger(1, 'pointermove', 320, 400);
  finger(1, 'pointermove', 380, 400);
  const panned = editor.getCamera();
  expect(panned.x).toBe(camera.x + 60);
  pen('pointerdown', 150, 150);
  finger(1, 'pointermove', 480, 400);
  expect(editor.getCamera()).toEqual(panned);
  pen('pointerup', 150, 150);
  finger(1, 'pointerup', 480, 400);
});

it('keeps the hand holding the pen from every tool until it lifts', () => {
  const { finger, pen, mouse, heard } = setup({ tool: () => 'select' });

  // The palm lands beside the pen, shifts and lifts.
  pen('pointerdown', 150, 150);
  finger(1, 'pointerdown', 300, 400);
  finger(1, 'pointermove', 320, 410);
  finger(1, 'pointerup', 320, 410);
  pen('pointerup', 150, 150);
  expect(heard).toEqual(['pointerdown pen', 'pointerup pen']);

  // The palm got there first. The tools hear it land and hear that it was
  // void; what it does after that, here being taken away by the system (which
  // would drop the pen's connector), reaches none of them.
  heard.length = 0;
  finger(1, 'pointerdown', 300, 400);
  pen('pointerdown', 150, 150);
  finger(1, 'pointermove', 320, 410);
  finger(1, 'pointercancel', 320, 410);
  pen('pointerup', 150, 150);
  expect(heard).toEqual([
    'pointerdown touch',
    'pointercancel touch',
    'pointerdown pen',
    'pointerup pen',
  ]);

  // A finger beside a pressed mouse is not a resting hand: tools hear of it
  // as they always did.
  heard.length = 0;
  mouse('pointerdown', 150, 150);
  finger(1, 'pointerdown', 300, 400);
  finger(1, 'pointerup', 300, 400);
  mouse('pointerup', 150, 150);
  expect(heard).toEqual([
    'pointerdown mouse',
    'pointerdown touch',
    'pointerup touch',
    'pointerup mouse',
  ]);
});

it('lets the hand beside a pen pan nothing where fingers pan', () => {
  const { editor, finger, pen, heard } = setup({
    tool: () => 'pencil',
    fingerPans: () => true,
  });
  const camera = editor.getCamera();

  pen('pointerdown', 150, 150);
  finger(1, 'pointerdown', 300, 400);
  finger(1, 'pointermove', 340, 440);
  pen('pointermove', 200, 180);
  finger(1, 'pointermove', 400, 480);
  pen('pointerup', 200, 180);
  // The pen has lifted, and the hand still has not.
  finger(1, 'pointermove', 420, 500);
  finger(1, 'pointerup', 420, 500);

  expect(editor.getCamera()).toEqual(camera);
  expect(Object.keys(editor.document.items)).toHaveLength(3);
  expect(heard.filter((event) => event.endsWith('touch'))).toEqual([]);
});

it('takes the surface from fingers for a pen and not a mouse', () => {
  const { editor, finger, mouse } = setup({
    tool: () => 'pencil',
    fingerPans: () => true,
  });

  finger(1, 'pointerdown', 300, 400);
  finger(1, 'pointermove', 320, 400);
  finger(1, 'pointermove', 380, 400);
  expect(editor.getCamera().x).toBe(60);

  mouse('pointerdown', 150, 150);
  finger(1, 'pointermove', 420, 400);
  expect(editor.getCamera().x).toBe(100);
  mouse('pointerup', 150, 150);
  finger(1, 'pointerup', 420, 400);
});

it('turns a finger held still into a long press and spends the finger', () => {
  vi.useFakeTimers();
  const pressed = vi.fn();
  const { editor, finger } = setup({
    tool: () => 'select',
    longPress: () => pressed,
  });
  const before = editor.document;

  // The press lands on the shape, which starts a move, and drifts a little.
  finger(1, 'pointerdown', 20, 20);
  finger(1, 'pointermove', 24, 23);
  expect(editor.getSession().transform).toBeDefined();
  vi.advanceTimersByTime(500);

  expect(pressed).toHaveBeenCalledWith({ x: 20, y: 20 });
  expect(editor.getSession().transform).toBeUndefined();

  // Dragging on afterwards moves nothing.
  finger(1, 'pointermove', 120, 90);
  finger(1, 'pointerup', 120, 90);
  expect(editor.document).toBe(before);
  expect(editor.getSession().canUndo).toBe(false);
});

/**
 * A row of the menu a host opens for a long press, under the finger, and the
 * events a browser sends it as that finger lifts.
 */
function menuRowUnderFinger() {
  const row = document.createElement('button');
  document.body.append(row);
  const pressed = vi.fn();
  for (const type of ['mousedown', 'mouseup', 'click'])
    row.addEventListener(type, pressed);
  // The test DOM marks every dispatched event as a script's. A browser's own
  // are trusted, and the mark is kept on the event's implementation object.
  let scripted = false;
  const trust = (event: Event) => {
    if (scripted) return;
    const implementation = Object.getOwnPropertySymbols(event)
      .map((symbol) => (event as unknown as Record<symbol, unknown>)[symbol])
      .find(
        (value): value is { isTrusted: boolean } =>
          typeof value === 'object' && value !== null && 'isTrusted' in value
      );
    if (!implementation) throw new Error('The test DOM changed its events');
    implementation.isTrusted = true;
  };
  for (const type of ['mousedown', 'mouseup', 'click'])
    window.addEventListener(type, trust, true);
  cleanups.push(() => {
    row.remove();
    for (const type of ['mousedown', 'mouseup', 'click'])
      window.removeEventListener(type, trust, true);
  });
  /** Whether the event was left alone. */
  const send = (type: string) =>
    row.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true })
    );
  const liftClick = () => ['mousedown', 'mouseup', 'click'].map(send);
  /** A click a script makes, which no finger had a part in. */
  const scriptClick = () => {
    scripted = true;
    row.click();
    scripted = false;
  };
  return { row, pressed, send, liftClick, scriptClick };
}

it('lets the lift of a long press click nothing', () => {
  vi.useFakeTimers();
  // The row first, so that its events are trusted by the time they are judged.
  const { pressed, liftClick, send, scriptClick } = menuRowUnderFinger();
  const { finger } = setup({ tool: () => 'select', longPress: () => vi.fn() });

  // However long the finger rests before it lifts.
  finger(1, 'pointerdown', 20, 20);
  vi.advanceTimersByTime(500);
  vi.advanceTimersByTime(2000);
  // A script's click meanwhile is not the finger's, and changes nothing.
  scriptClick();
  expect(pressed).toHaveBeenCalledTimes(1);
  finger(1, 'pointerup', 20, 20);
  expect(liftClick()).toEqual([false, false, false]);
  expect(pressed).toHaveBeenCalledTimes(1);

  // That was the lift's click. The next one is somebody's own.
  send('click');
  expect(pressed).toHaveBeenCalledTimes(2);
});

it('still swallows the lift after another finger joined the long press', () => {
  vi.useFakeTimers();
  const { pressed, liftClick } = menuRowUnderFinger();
  const { finger } = setup({ tool: () => 'select', longPress: () => vi.fn() });

  finger(1, 'pointerdown', 20, 20);
  vi.advanceTimersByTime(500);
  finger(2, 'pointerdown', 120, 20);
  finger(1, 'pointerup', 20, 20);
  expect(liftClick()).toEqual([false, false, false]);
  finger(2, 'pointerup', 120, 20);
  expect(pressed).not.toHaveBeenCalled();
});

it('leaves a click alone once the long press is over', () => {
  vi.useFakeTimers();
  const { row, pressed, send } = menuRowUnderFinger();
  const { finger } = setup({ tool: () => 'select', longPress: () => vi.fn() });
  const longPress = () => {
    finger(1, 'pointerdown', 20, 20);
    vi.advanceTimersByTime(500);
  };

  // Not every lift is followed by a click. A tap on the row afterwards starts
  // with its own press.
  longPress();
  finger(1, 'pointerup', 20, 20);
  row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  send('click');
  expect(pressed).toHaveBeenCalledTimes(1);

  // So does a tap after a lift that was never reported.
  longPress();
  row.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, isPrimary: true })
  );
  send('click');
  expect(pressed).toHaveBeenCalledTimes(2);

  // A key that presses the row is its own too.
  longPress();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  send('click');
  expect(pressed).toHaveBeenCalledTimes(3);
  finger(1, 'pointerup', 20, 20);

  // And so is a click with no press before it, a while after the lift,
  // whether the finger lifted or the system took it away.
  for (const lift of ['pointerup', 'pointercancel'] as const) {
    pressed.mockClear();
    longPress();
    finger(1, lift, 20, 20);
    vi.advanceTimersByTime(499);
    expect(send('click')).toBe(false);
    longPress();
    finger(1, lift, 20, 20);
    vi.advanceTimersByTime(500);
    expect(send('click')).toBe(true);
    expect(pressed).toHaveBeenCalledTimes(1);
  }
});

it('swallows no click after a tap, a drag, or a press the host did not take', () => {
  vi.useFakeTimers();
  const { pressed, send } = menuRowUnderFinger();
  const taken = setup({ tool: () => 'select', longPress: () => vi.fn() });

  taken.finger(1, 'pointerdown', 20, 20);
  taken.finger(1, 'pointerup', 20, 20);
  send('click');
  expect(pressed).toHaveBeenCalledTimes(1);

  taken.finger(1, 'pointerdown', 20, 20);
  taken.finger(1, 'pointermove', 60, 20);
  vi.advanceTimersByTime(600);
  taken.finger(1, 'pointerup', 60, 20);
  send('click');
  expect(pressed).toHaveBeenCalledTimes(2);

  const left = setup({ tool: () => 'rectangle', longPress: () => undefined });
  left.finger(1, 'pointerdown', 150, 150);
  vi.advanceTimersByTime(600);
  left.finger(1, 'pointerup', 150, 150);
  send('click');
  expect(pressed).toHaveBeenCalledTimes(3);
});

it('stops swallowing when the surface goes away', () => {
  vi.useFakeTimers();
  const { pressed, send } = menuRowUnderFinger();
  const { finger, detach } = setup({
    tool: () => 'select',
    longPress: () => vi.fn(),
  });

  finger(1, 'pointerdown', 20, 20);
  vi.advanceTimersByTime(500);
  detach();
  send('click');
  expect(pressed).toHaveBeenCalledTimes(1);
});

it('does not long press once the finger has started dragging or lifted', () => {
  vi.useFakeTimers();
  const pressed = vi.fn();
  const { finger } = setup({ tool: () => 'select', longPress: () => pressed });

  finger(1, 'pointerdown', 20, 20);
  finger(1, 'pointermove', 40, 20);
  vi.advanceTimersByTime(600);
  finger(1, 'pointerup', 40, 20);

  finger(1, 'pointerdown', 200, 200);
  finger(1, 'pointerup', 200, 200);
  vi.advanceTimersByTime(600);

  // A second finger makes it a pinch, not a press.
  finger(1, 'pointerdown', 200, 200);
  finger(2, 'pointerdown', 260, 200);
  vi.advanceTimersByTime(600);

  expect(pressed).not.toHaveBeenCalled();
});

it('leaves a still finger to the tool when the host takes no long press', () => {
  vi.useFakeTimers();
  const { editor, finger } = setup({
    tool: () => 'rectangle',
    longPress: () => undefined,
  });

  finger(1, 'pointerdown', 150, 150);
  vi.advanceTimersByTime(600);
  finger(1, 'pointermove', 220, 230);
  finger(1, 'pointerup', 220, 230);

  expect(Object.keys(editor.document.items)).toHaveLength(3);
});

it('leaves a single finger to the tool', () => {
  const { editor, finger } = setup({ tool: () => 'pan' });

  finger(1, 'pointerdown', 100, 100);
  finger(1, 'pointermove', 140, 130);
  finger(1, 'pointerup', 140, 130);

  expect(editor.getCamera()).toEqual({ x: 40, y: 30, scale: 1 });
});

it('moves the camera once a frame however often the fingers report', () => {
  const { editor, viewport } = setup({ tool: () => 'pan' });
  const moves = vi.fn();
  cleanups.push(editor.subscribeCamera(moves));
  // Raw events: the helper above runs a frame after each one.
  const raw = (id: number, type: string, x: number, y: number) =>
    viewport.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType: 'touch',
        isPrimary: id === 1,
        buttons: 1,
        clientX: x,
        clientY: y,
      })
    );
  raw(1, 'pointerdown', 200, 200);
  raw(2, 'pointerdown', 300, 200);
  moves.mockClear();

  raw(1, 'pointermove', 180, 200);
  raw(2, 'pointermove', 320, 200);
  raw(1, 'pointermove', 150, 200);
  raw(2, 'pointermove', 350, 200);
  expect(moves).not.toHaveBeenCalled();
  runFrame();

  expect(moves).toHaveBeenCalledOnce();
  expect(editor.getCamera().scale).toBe(2);
});
