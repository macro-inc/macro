import { createGraphicsEditor, screenToWorld } from '@macro-inc/graphics';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasFraming } from './canvas-framing';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

/** An element whose box is whatever the test last said it was. */
function box(rect: { x: number; y: number; width: number; height: number }) {
  const element = document.createElement('div');
  const state = { ...rect };
  element.getBoundingClientRect = () =>
    new DOMRect(state.x, state.y, state.width, state.height);
  Object.defineProperties(element, {
    clientWidth: { get: () => state.width },
    clientHeight: { get: () => state.height },
  });
  return { element, set: (next: typeof rect) => Object.assign(state, next) };
}

/**
 * A phone-sized canvas showing a 400 x 400 square, with a frame that leaves
 * 100px for a header and 200px for the bottom chrome.
 */
function setup() {
  const editor = createGraphicsEditor([
    {
      id: 'square',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: [1, 0, 0, 1, 0, 0],
      geometry: { width: 400, height: 400 },
      appearance: { fill: 'white', stroke: 'black' },
    },
  ]);
  const host = box({ x: 0, y: 0, width: 400, height: 800 });
  document.body.append(host.element);
  cleanups.push(() => host.element.remove());
  const frame = box({ x: 0, y: 100, width: 400, height: 500 });
  // Observers in the order they were made: the frame's, then any text's.
  const observers: (() => void)[] = [];
  const resized = () => observers[0]?.();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  let typing = (_text: ReturnType<typeof box>) => {};
  const framing = createRoot((dispose) => {
    cleanups.push(dispose, () => editor.dispose(), vi.unstubAllGlobals);
    const framing = createCanvasFraming(editor, () => host.element);
    framing.watchPresses(host.element);
    framing.frameWithin(frame.element, 24);
    typing = (text) => framing.keepInFrame(text.element);
    return framing;
  });
  /** Where the square is on screen: its left, top and size. */
  const square = () => {
    const { x, y, scale } = editor.getCamera();
    return { left: x, top: y, size: 400 * scale };
  };
  return {
    editor,
    framing,
    host,
    frame,
    square,
    resized,
    /** A finger lands on the canvas. */
    press: () =>
      host.element.dispatchEvent(new Event('pointerdown', { bubbles: true })),
    /** Start keeping `text` in view; returns its own "it changed size". */
    typing(text: ReturnType<typeof box>) {
      typing(text);
      return () => observers[observers.length - 1]?.();
    },
  };
}

it('fits into the frame, with the margin the view asked for', () => {
  const { framing, square } = setup();

  framing.fit();

  // 400 - 2 x 24 wide, centred between the header and the bottom chrome.
  expect(square()).toEqual({ left: 24, top: 100 + (500 - 352) / 2, size: 352 });
});

it('zooms about the middle of the frame, not of the whole view', () => {
  const { framing } = setup();
  expect(framing.centre()).toEqual({ x: 200, y: 350 });
});

it('redoes the fit when the chrome settles, while nobody has moved the canvas', () => {
  const { framing, frame, square, resized } = setup();
  framing.fit();

  // The bottom chrome is measured after the first paint and turns out taller.
  frame.set({ x: 0, y: 100, width: 400, height: 300 });
  resized();

  // Now the height is what limits it: 300 - 2 x 24.
  expect(square()).toEqual({ left: 74, top: 124, size: 252 });
});

it('keeps the middle in the middle through a rotation once the canvas was moved', () => {
  const { editor, framing, host, frame, resized, press } = setup();
  framing.fit();
  resized();
  press();
  editor.panBy({ x: 30, y: -40 });
  const middle = screenToWorld(editor.getCamera(), framing.centre());

  host.set({ x: 0, y: 0, width: 800, height: 400 });
  frame.set({ x: 0, y: 60, width: 800, height: 240 });
  resized();

  expect(framing.centre()).toEqual({ x: 400, y: 180 });
  const after = screenToWorld(editor.getCamera(), framing.centre());
  expect(after.x).toBeCloseTo(middle.x);
  expect(after.y).toBeCloseTo(middle.y);
});

it('moves nothing when only the chrome changes under a canvas that was moved', () => {
  const { editor, framing, frame, resized, press } = setup();
  framing.fit();
  resized();
  press();
  const camera = editor.getCamera();

  // A second row of buttons appears in the bottom chrome.
  frame.set({ x: 0, y: 100, width: 400, height: 440 });
  resized();

  expect(editor.getCamera()).toEqual(camera);
});

it('pans the text being typed up from behind the keyboard', () => {
  const { editor, frame, typing, resized } = setup();
  const before = editor.getCamera();
  // Text low on the screen, where the keyboard is about to be.
  const text = box({ x: 100, y: 520, width: 120, height: 30 });
  typing(text);

  // The keyboard takes the lower half: the frame now ends at 380.
  frame.set({ x: 0, y: 100, width: 400, height: 280 });
  resized();

  // Its bottom edge was at 550 and has to clear 380 by 16px.
  expect(editor.getCamera()).toEqual({ ...before, y: before.y - 186 });
});

type Box = { x: number; y: number; width: number; height: number };

/**
 * Put a selection inside `text`: its moving end at `focus` on screen and,
 * when it is not collapsed, the end it was dragged from at `anchor`, later in
 * the text. The test DOM lays nothing out, so the boxes are given.
 */
function selectionAt(text: ReturnType<typeof box>, focus: Box, anchor?: Box) {
  const rect = (at: Box) => new DOMRect(at.x, at.y, at.width, at.height);
  const boxes = [rect(focus), ...(anchor ? [rect(anchor)] : [])];
  const range = () => {
    let from = 0;
    let collapsed = false;
    return {
      endContainer: text.element,
      setStart(_node: Node, offset: number) {
        from = offset;
      },
      collapse() {
        collapsed = true;
      },
      // A range's boxes run in the text's order, whichever way it was dragged.
      getClientRects: () => (collapsed ? [boxes[from]] : boxes.slice(from)),
      getBoundingClientRect: () => boxes[from],
    };
  };
  vi.spyOn(document, 'getSelection').mockReturnValue({
    rangeCount: 1,
    focusNode: text.element,
    focusOffset: 0,
    getRangeAt: () => range(),
  } as unknown as Selection);
  vi.spyOn(document, 'createRange').mockImplementation(
    () => range() as unknown as Range
  );
  cleanups.push(() => vi.restoreAllMocks());
}
const caretAt = (text: ReturnType<typeof box>, at: Box) =>
  selectionAt(text, at);

it('follows the caret of a line that grows past the right edge', () => {
  const { editor, typing } = setup();
  const before = editor.getCamera();
  const text = box({ x: 300, y: 200, width: 60, height: 30 });
  const grew = typing(text);
  grew();
  expect(editor.getCamera()).toEqual(before);

  // Wider than the frame now, the caret at its end.
  text.set({ x: 300, y: 200, width: 500, height: 30 });
  caretAt(text, { x: 799, y: 200, width: 1, height: 30 });
  grew();

  expect(editor.getCamera()).toEqual({ ...before, x: before.x - 416 });
});

it('leaves a long text where it is when the caret is already in view', () => {
  const { editor, typing } = setup();
  const before = editor.getCamera();
  // A line far wider than the frame, tapped near its start to fix a typo.
  const text = box({ x: 20, y: 200, width: 900, height: 30 });
  const grew = typing(text);
  grew();
  expect(editor.getCamera()).toEqual(before);

  caretAt(text, { x: 60, y: 200, width: 1, height: 30 });
  document.dispatchEvent(new Event('selectionchange'));

  expect(editor.getCamera()).toEqual(before);
});

it('follows the end of a selection that moves, not the end it was dragged from', () => {
  const { editor, typing } = setup();
  const before = editor.getCamera();
  // A text far wider than the frame, selected backward from beyond its edge.
  const text = box({ x: 20, y: 200, width: 900, height: 30 });
  const grew = typing(text);
  grew();
  expect(editor.getCamera()).toEqual(before);

  selectionAt(
    text,
    { x: 60, y: 200, width: 1, height: 30 },
    { x: 800, y: 200, width: 1, height: 30 }
  );
  document.dispatchEvent(new Event('selectionchange'));

  expect(editor.getCamera()).toEqual(before);
});

it('moves nothing for a keyboard that only makes the view shorter', () => {
  const { editor, framing, host, frame, resized, press } = setup();
  framing.fit();
  resized();
  press();
  const camera = editor.getCamera();

  // Typing in a field elsewhere on the page: the canvas has no text of its own.
  host.set({ x: 0, y: 0, width: 400, height: 460 });
  frame.set({ x: 0, y: 100, width: 400, height: 360 });
  resized();

  expect(editor.getCamera()).toEqual(camera);
});

it('does not take a fit of an empty canvas as one to keep up', () => {
  const { editor, framing, frame, resized } = setup();
  editor.select('square');
  editor.deleteSelection();
  framing.fit();
  const empty = editor.getCamera();

  // Something is put on the canvas and the chrome changes for it.
  editor.undo();
  frame.set({ x: 0, y: 100, width: 300, height: 500 });
  resized();

  expect(editor.getCamera()).toEqual(empty);
});

it('stops redoing the fit once text is being typed', () => {
  const { editor, framing, frame, typing, resized } = setup();
  framing.fit();
  const fitted = editor.getCamera();
  // Started from the keyboard, with no press on the canvas.
  typing(box({ x: 100, y: 200, width: 120, height: 30 }));

  frame.set({ x: 0, y: 100, width: 400, height: 280 });
  resized();

  expect(editor.getCamera().scale).toBe(fitted.scale);
});

it('keeps to what the visual viewport shows where the page ignores the keyboard', () => {
  const { editor, typing } = setup();
  const before = editor.getCamera();
  // A tablet browser: the frame keeps its size, the keyboard only shortens
  // the visual viewport to 450.
  const visual = Object.assign(new EventTarget(), {
    offsetLeft: 0,
    offsetTop: 0,
    width: 400,
    height: 450,
  });
  vi.stubGlobal('visualViewport', visual);
  const text = box({ x: 100, y: 520, width: 120, height: 30 });
  typing(text);

  visual.dispatchEvent(new Event('resize'));

  expect(editor.getCamera()).toEqual({ ...before, y: before.y - 116 });
});
