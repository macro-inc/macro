import { createGraphicsEditor, insertShapesCommand } from '@macro-inc/graphics';
import { attachCameraControls } from '@macro-inc/graphics/browser';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasState } from './create-canvas-state';
import { attachTextInput } from './text-input';

// The test DOM has no PointerEvent. Touch navigation creates one to tell the
// tools that a pen has taken the surface from a finger.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
  }
}
vi.stubGlobal('PointerEvent', TestPointerEvent);

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
const MOUSE = { pointerId: 1, pointerType: 'mouse' };
const PEN = { pointerId: 2, pointerType: 'pen' };
const PALM = { pointerId: 3, pointerType: 'touch' };

function setup() {
  const editor = createGraphicsEditor([
    {
      id: 'box',
      type: 'rectangle',
      placement: { parentId: 'scene-root', sortKey: 'a0' },
      transform: [1, 0, 0, 1, 20, 20],
      geometry: { width: 200, height: 100 },
      appearance: { fill: 'red', stroke: 'black' },
    },
  ]);
  const root = document.createElement('div'),
    viewport = document.createElement('div');
  viewport.setAttribute('aria-label', 'Graphics canvas');
  root.append(viewport);
  document.body.append(root);
  viewport.setPointerCapture = vi.fn();
  viewport.hasPointerCapture = () => false;
  const state = createRoot((dispose) => {
    cleanups.push(dispose);
    return createCanvasState(editor, (g) => ({ width: g.width, height: 32.4 }));
  });
  const detach = attachTextInput(root, state),
    detachCanvas = attachCameraControls(viewport, editor, {
      tool: () => 'select',
      suspended: () => !!state.text.draft(),
    });
  cleanups.push(() => {
    detach();
    detachCanvas();
    editor.dispose();
    root.remove();
  });
  const pointer = (
    target: EventTarget,
    type: string,
    x: number,
    y: number,
    from: { pointerId: number; pointerType: string } = MOUSE
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, 'pointerId', { value: from.pointerId });
    Object.defineProperty(event, 'pointerType', { value: from.pointerType });
    target.dispatchEvent(event);
  };
  return { state, viewport, pointer };
}
it('enters a shape label after two stationary taps even without a native dblclick', () => {
  const { state, viewport, pointer } = setup();
  pointer(viewport, 'pointerdown', 100, 60);
  pointer(window, 'pointerup', 100, 60);
  expect(state.text.draft()).toBeUndefined();
  pointer(viewport, 'pointerdown', 100, 60);
  pointer(window, 'pointerup', 100, 60);
  expect(state.text.isLabel()).toBe(true);
  expect(state.text.draft()?.id).toBe('box');
  expect(state.editor.getSession().transform).toBeUndefined();
});
it('does not interpret a move followed by a click as a label double-click', () => {
  const { state, viewport, pointer } = setup();
  pointer(viewport, 'pointerdown', 100, 60);
  pointer(window, 'pointermove', 130, 60);
  pointer(window, 'pointerup', 130, 60);
  pointer(viewport, 'pointerdown', 130, 60);
  pointer(window, 'pointerup', 130, 60);
  expect(state.text.draft()).toBeUndefined();
  expect(state.editor.document.items.box).toMatchObject({
    transform: [1, 0, 0, 1, 50, 20],
  });
});

it('edits a label with the text tool on release, and not after a cancelled press', () => {
  const { state, viewport, pointer } = setup();
  state.chooseTool('text');

  // A second finger landing to pinch cancels the first finger's press.
  pointer(viewport, 'pointerdown', 100, 60);
  expect(state.text.draft()).toBeUndefined();
  pointer(window, 'pointercancel', 100, 60);
  pointer(window, 'pointerup', 100, 60);
  expect(state.text.draft()).toBeUndefined();

  pointer(viewport, 'pointerdown', 100, 60);
  pointer(window, 'pointerup', 100, 60);
  expect(state.text.isLabel()).toBe(true);
  expect(state.text.draft()?.id).toBe('box');
});

it('keeps a pen press on the text tool when a palm lands beside it', () => {
  const { state, viewport, pointer } = setup();
  state.chooseTool('text');

  // The pen presses the box; a palm then rests on empty canvas and lifts.
  pointer(viewport, 'pointerdown', 100, 60, PEN);
  pointer(viewport, 'pointerdown', 400, 300, PALM);
  pointer(window, 'pointerup', 400, 300, PALM);
  expect(state.text.draft()).toBeUndefined();

  pointer(window, 'pointerup', 100, 60, PEN);
  expect(state.text.isLabel()).toBe(true);
  expect(state.text.draft()?.id).toBe('box');
});

it('gives the text tool to a pen that presses while a palm rests', () => {
  const { state, viewport, pointer } = setup();
  state.chooseTool('text');

  // The palm is down first; the system takes it away once the pen arrives.
  pointer(viewport, 'pointerdown', 400, 300, PALM);
  pointer(viewport, 'pointerdown', 100, 60, PEN);
  pointer(window, 'pointercancel', 400, 300, PALM);
  pointer(window, 'pointerup', 100, 60, PEN);

  expect(state.text.isLabel()).toBe(true);
  expect(state.text.draft()?.id).toBe('box');
});

it('does not create canvas text when double-clicking a document or embed', () => {
  const { viewport, state, pointer } = setup();
  const card = document.createElement('div');
  card.dataset.canvasDocument = 'doc';
  const button = document.createElement('button');
  card.append(button);
  viewport.append(card);
  for (let i = 0; i < 2; i++) {
    pointer(button, 'pointerdown', 50, 50);
    pointer(button, 'pointerup', 50, 50);
  }
  button.dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 50 })
  );
  expect(state.text.draft()).toBeUndefined();
});

it('opens an embed when pointer capture retargets double-click to the viewport', () => {
  const { viewport, state } = setup();
  state.editor.execute(insertShapesCommand, [
    {
      item: {
        id: 'embed',
        type: 'document',
        geometry: {
          documentId: 'file',
          name: 'Note',
          fileType: 'md',
          display: 'embed',
          width: 320,
          height: 240,
        },
        appearance: { fill: 'white', stroke: 'transparent' },
      },
      point: { x: 0, y: 0 },
    },
  ]);
  viewport.dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, clientX: 100, clientY: 100 })
  );
  expect(state.embeds.active()).toBe('embed');
  expect(state.text.draft()).toBeUndefined();
});
