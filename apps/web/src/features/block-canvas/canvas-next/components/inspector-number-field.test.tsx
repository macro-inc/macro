import { createGraphicsEditor, styleCommand } from '@macro-inc/graphics';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasNextScene } from '../core/seed-scene';
import { createInspectorPreview } from '../primitives/create-inspector-preview';
import { InspectorNumberField } from './inspector-number-field';

afterEach(cleanup);

it('preserves fractional input and keyboard nudges when snapping is disabled', () => {
  const change = vi.fn();
  render(() => (
    <InspectorNumberField
      label="Position X"
      icon={<span>X</span>}
      value={1.25}
      min={-Infinity}
      step="any"
      onChange={change}
    />
  ));
  const input = screen.getByRole('textbox', { name: 'Position X' });
  fireEvent.change(input, { target: { value: '4.125' } });
  expect(change).toHaveBeenLastCalledWith(4.125);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Adjust Position X' }), {
    key: 'ArrowRight',
  });
  expect(change).toHaveBeenLastCalledWith(2.25);
});

function setup() {
  const editor = createGraphicsEditor(createCanvasNextScene());
  editor.select('welcome-rectangle');
  let preview!: ReturnType<typeof createInspectorPreview>;
  const commit = vi.fn((strokeWidth: number) =>
    editor.setSelectionAppearance({ strokeWidth })
  );
  const view = render(() => {
    preview = createInspectorPreview(editor);
    return (
      <InspectorNumberField
        label="Stroke width"
        icon={<span>W</span>}
        value={2}
        max={40}
        step={0.5}
        onChange={commit}
        onScrub={() =>
          preview.begin(
            (context, strokeWidth) =>
              styleCommand.apply(context, { strokeWidth }).document,
            commit
          )
        }
      />
    );
  });
  const handle = screen.getByRole('button', { name: 'Adjust Stroke width' });
  let capture = false;
  handle.setPointerCapture = () => {
    capture = true;
  };
  handle.releasePointerCapture = () => {
    capture = false;
  };
  handle.hasPointerCapture = () => capture;
  const pointer = (type: string, x: number, shiftKey = false, pointerId = 1) =>
    fireEvent(
      handle,
      Object.assign(
        new MouseEvent(type, {
          bubbles: true,
          clientX: x,
          button: 0,
          shiftKey,
        }),
        { pointerId }
      )
    );
  return { editor, preview, commit, pointer, handle, view };
}

it('paints each scrub sample before release, then commits the final pointer position once', () => {
  const { editor, preview, commit, pointer } = setup();
  pointer('pointerdown', 100);
  pointer('pointermove', 110);
  expect(preview.document()?.items['welcome-rectangle']).toMatchObject({
    appearance: { strokeWidth: 7 },
  });
  expect(editor.document.items['welcome-rectangle']).toMatchObject({
    appearance: { strokeWidth: 2 },
  });
  expect(commit).not.toHaveBeenCalled();
  pointer('pointerup', 120);
  expect(commit).toHaveBeenCalledExactlyOnceWith(12);
  expect(preview.document()).toBeUndefined();
  editor.undo();
  expect(editor.document.items['welcome-rectangle']).toMatchObject({
    appearance: { strokeWidth: 2 },
  });
  expect(editor.getSession().canUndo).toBe(false);
});

it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'unmount'])(
  'restores the scene on %s',
  (cancel) => {
    const { editor, preview, commit, pointer, handle, view } = setup();
    pointer('pointerdown', 100);
    pointer('pointermove', 140, true);
    expect(preview.document()?.items['welcome-rectangle']).toMatchObject({
      appearance: { strokeWidth: 40 },
    });
    if (cancel === 'Escape') fireEvent.keyDown(handle, { key: 'Escape' });
    else if (cancel === 'blur') fireEvent(window, new Event('blur'));
    else if (cancel === 'unmount') view.unmount();
    else pointer(cancel, 140);
    pointer('pointerup', 140);
    expect(preview.document()).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
    expect(editor.getSession().canUndo).toBe(false);
    expect(handle.hasPointerCapture(1)).toBe(false);
  }
);

it('ignores other pointers and creates no history for a click or a return to the starting value', () => {
  const { editor, preview, commit, pointer } = setup();
  pointer('pointerdown', 100);
  pointer('pointerup', 100);
  pointer('pointerdown', 100);
  pointer('pointermove', 140, false, 2);
  expect(preview.document()).toBeUndefined();
  pointer('pointermove', 110);
  pointer('pointerup', 100);
  expect(preview.document()).toBeUndefined();
  expect(commit).not.toHaveBeenCalled();
  expect(editor.getSession().canUndo).toBe(false);
});
