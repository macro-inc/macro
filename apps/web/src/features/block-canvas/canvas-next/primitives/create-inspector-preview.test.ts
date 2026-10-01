import { createGraphicsEditor, styleCommand } from '@macro-inc/graphics';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasNextScene } from '../core/seed-scene';
import { layoutValue, selectionLayoutCommand } from '../core/selection-layout';
import { plainRichText } from '../core/text-codec';
import { createInspectorPreview } from './create-inspector-preview';
import { createTextState } from './create-text-state';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup() {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const editor = createGraphicsEditor(createCanvasNextScene());
    cleanups.push(editor.dispose);
    editor.select('welcome-rectangle');
    const preview = createInspectorPreview(editor);
    const style = () =>
      preview.begin(
        (context, opacity) => styleCommand.apply(context, { opacity }).document,
        (opacity) => editor.setSelectionAppearance({ opacity })
      );
    const text = createTextState(
      editor,
      (geometry) => ({
        width: geometry.width,
        height: geometry.fontSize * 1.35,
      }),
      () => ({ fill: 'transparent', stroke: '#000000' })
    );
    return { editor, preview, style, text, dispose };
  });
}

it('previews without publishing saved document changes and commits one undo step', () => {
  const { editor, preview, style } = setup();
  const before = editor.document;
  const changed = vi.fn();
  editor.subscribeDocument(changed);
  const drag = style();
  drag.preview(0.7);
  drag.preview(0.4);
  expect(preview.document()?.items['welcome-rectangle']).toMatchObject({
    appearance: { opacity: 0.4 },
  });
  expect(editor.document).toBe(before);
  expect(changed).not.toHaveBeenCalled();
  expect(editor.getSession().canUndo).toBe(false);
  drag.commit(0.4);
  expect(preview.document()).toBeUndefined();
  expect(changed).toHaveBeenCalledTimes(1);
  editor.undo();
  expect(editor.document).toEqual(before);
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  expect(editor.document.items['welcome-rectangle']).toMatchObject({
    appearance: { opacity: 0.4 },
  });
});

it('derives rotation previews from the starting scene, not previous samples', () => {
  const { editor, preview } = setup();
  const payload = (value: number) => ({ field: 'rotation' as const, value });
  const drag = preview.begin(
    (context, value) =>
      selectionLayoutCommand.apply(context, payload(value)).document,
    (value) => editor.execute(selectionLayoutCommand, payload(value))
  );
  drag.preview(90);
  drag.preview(30);
  expect(
    layoutValue(preview.document()!, ['welcome-rectangle'], 'rotation')
  ).toBe(30);
  expect(layoutValue(editor.document, ['welcome-rectangle'], 'rotation')).toBe(
    0
  );
  drag.cancel();
  expect(preview.document()).toBeUndefined();
  expect(editor.getSession().canUndo).toBe(false);
});

it.each(['selection', 'document', 'dispose'] as const)(
  'invalidates stale gestures after %s changes',
  (kind) => {
    const { editor, preview, style, dispose } = setup();
    const drag = style();
    drag.preview(0.5);
    if (kind === 'selection') editor.select('welcome-ellipse');
    if (kind === 'document') editor.setSelectionAppearance({ strokeWidth: 8 });
    if (kind === 'dispose') dispose();
    const before = editor.document;
    drag.preview(0.2);
    drag.commit(0.2);
    expect(preview.document()).toBeUndefined();
    expect(editor.document).toBe(before);
  }
);

it('previews shape-label font size and leaves the original geometry intact on cancel', () => {
  const { editor, text, preview } = setup();
  text.edit('welcome-rectangle');
  text.change(plainRichText('Label'));
  text.finish();
  const before = editor.document;
  const drag = text.scrubFontSize(preview);
  drag.preview(48);
  expect(preview.document()?.items['welcome-rectangle']).toMatchObject({
    geometry: { label: { fontSize: 48 } },
  });
  expect(editor.document).toBe(before);
  drag.cancel();
  expect(editor.document).toBe(before);
  const next = text.scrubFontSize(preview);
  next.preview(36);
  next.commit(36);
  expect(editor.document.items['welcome-rectangle']).toMatchObject({
    geometry: { label: { fontSize: 36 } },
  });
  editor.undo();
  expect(editor.document).toEqual(before);
});

it('restores an active text draft and its defaults on cancellation', () => {
  const { editor, text, preview } = setup();
  text.begin({ x: 10, y: 20 });
  text.change(plainRichText('Draft'));
  const original = text.draft();
  const drag = text.scrubFontSize(preview);
  drag.preview(48);
  expect(text.draft()?.geometry.fontSize).toBe(48);
  expect(text.defaults().fontSize).toBe(24);
  drag.cancel();
  expect(text.draft()).toBe(original);
  expect(editor.getSession().canUndo).toBe(false);
  const next = text.scrubFontSize(preview);
  next.preview(36);
  next.commit(36);
  expect(text.draft()?.geometry.fontSize).toBe(36);
  expect(text.defaults().fontSize).toBe(36);
  expect(editor.getSession().canUndo).toBe(false);
});

it('uses the same snap unit for layout scrubbing and commit, and cancels when it changes', () => {
  const { editor, preview } = setup();
  editor.setSnapUnit(8);
  const payload = (value: number) => ({
    field: 'width' as const,
    value,
    lockAspectRatio: true,
  });
  const begin = () =>
    preview.begin(
      (context, value) =>
        selectionLayoutCommand.apply(context, payload(value)).document,
      (value) => editor.execute(selectionLayoutCommand, payload(value))
    );
  const before = editor.document;
  const drag = begin();
  drag.preview(103);
  expect(layoutValue(preview.document()!, ['welcome-rectangle'], 'width')).toBe(
    104
  );
  expect(editor.document).toBe(before);
  drag.commit(103);
  expect(layoutValue(editor.document, ['welcome-rectangle'], 'width')).toBe(
    104
  );
  editor.undo();
  expect(editor.document).toEqual(before);
  const restored = editor.document;
  const cancelled = begin();
  cancelled.preview(103);
  editor.setSnapUnit(2);
  expect(preview.document()).toBeUndefined();
  cancelled.commit(103);
  expect(editor.document).toBe(restored);
});
