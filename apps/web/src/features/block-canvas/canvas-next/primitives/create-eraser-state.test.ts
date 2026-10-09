import { createGraphicsEditor, drawableIds } from '@macro-inc/graphics';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasNextScene } from '../core/seed-scene';
import { createEraserState } from './create-eraser-state';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
function setup() {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const editor = createGraphicsEditor(createCanvasNextScene());
    cleanups.push(editor.dispose);
    const state = createEraserState(editor, () => true);
    const element = document.createElement('div');
    element.setPointerCapture = vi.fn();
    element.hasPointerCapture = () => false;
    cleanups.push(state.attach(element));
    const pointer = (type: string, x: number, y: number) =>
      element.dispatchEvent(
        Object.assign(
          new MouseEvent(type, { clientX: x, clientY: y, button: 0 }),
          { pointerId: 1 }
        )
      );
    return { editor, state, pointer };
  });
}
it('previews removals, cancels without history, and fades the trail', () => {
  vi.useFakeTimers();
  const { editor, state, pointer } = setup();
  pointer('pointerdown', 120, 130);
  pointer('pointermove', 300, 130);
  expect(drawableIds(state.preview()!)).toHaveLength(3);
  expect(drawableIds(editor.document)).toHaveLength(3);
  vi.advanceTimersByTime(16);
  expect(state.trail().length).toBeGreaterThan(0);
  state.cancel();
  expect(state.preview()).toBeUndefined();
  expect(editor.getSession().canUndo).toBe(false);
  vi.advanceTimersByTime(350);
  expect(state.trail()).toEqual([]);
});
it('commits crossed shapes together on release and cancels a lost pointer', () => {
  const { editor, state, pointer } = setup();
  pointer('pointerdown', 0, 200);
  pointer('pointermove', 700, 200);
  pointer('pointerup', 700, 200);
  expect(state.preview()).toBeUndefined();
  expect(drawableIds(editor.document)).toEqual(['welcome-small']);
  editor.undo();
  expect(drawableIds(editor.document)).toHaveLength(3);
  pointer('pointerdown', 120, 130);
  pointer('pointercancel', 120, 130);
  expect(state.preview()).toBeUndefined();
  expect(drawableIds(editor.document)).toHaveLength(3);
});

it('thins points with age, expires them by time, and preserves the preview while moving', () => {
  vi.useFakeTimers();
  const { state, pointer } = setup();
  pointer('pointerdown', 120, 130);
  const preview = state.preview();
  for (let x = 122; x <= 220; x += 2) pointer('pointermove', x, 130);
  vi.advanceTimersByTime(16);
  expect(state.trail().length).toBeGreaterThan(10);
  const pressure = state.trail()[0]![2];
  vi.advanceTimersByTime(160);
  pointer('pointermove', 230, 130);
  vi.advanceTimersByTime(16);
  expect(state.trail()[0]![2]).toBeLessThan(pressure);
  expect(state.trail().at(-1)![2]).toBeGreaterThan(state.trail()[0]![2]);
  expect(state.preview()).toBe(preview);
  vi.advanceTimersByTime(144);
  expect(state.trail()).toHaveLength(1);
  vi.advanceTimersByTime(200);
  expect(state.trail()).toEqual([]);
});
it('previews erased shapes at one fifth of their original opacity without changing the document', () => {
  const { editor, state, pointer } = setup();
  editor.select('welcome-rectangle');
  editor.setSelectionAppearance({ opacity: 0.5 });
  pointer('pointerdown', 120, 130);
  expect(state.preview()!.items['welcome-rectangle']).toMatchObject({
    appearance: { opacity: 0.1 },
  });
  expect(editor.document.items['welcome-rectangle']).toMatchObject({
    appearance: { opacity: 0.5 },
  });
  pointer('pointercancel', 120, 130);
  expect(state.preview()).toBeUndefined();
});
