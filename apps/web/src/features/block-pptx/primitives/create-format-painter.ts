/**
 * PowerPoint's Format Painter: pick up the selected shape's look (or the
 * text formatting at the caret), then click shapes or select text to paint
 * it. A double-click on the button keeps the painter armed until Escape.
 * Cmd/Ctrl+Shift+C and Cmd/Ctrl+Shift+V copy and paste formatting without
 * arming it.
 */

import { createSignal } from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  type PainterSource,
  paintRangeOps,
  paintShapesOps,
  runAt,
} from '../core/format-painter';
import type { PresentationSession } from './create-presentation-session';
import type { createSlideEditor } from './create-slide-editor';

type SlideEditor = ReturnType<typeof createSlideEditor>;

const before = (
  a: { paragraph: number; offset: number },
  b: { paragraph: number; offset: number }
) =>
  a.paragraph < b.paragraph ||
  (a.paragraph === b.paragraph && a.offset < b.offset);

export function createFormatPainter(options: {
  engine: PresentationEngine;
  session: PresentationSession;
  editor: SlideEditor;
}) {
  const { engine, session, editor } = options;
  const [source, setSource] = createSignal<PainterSource | null>(null);
  const [armed, setArmed] = createSignal(false);
  const [sticky, setSticky] = createSignal(false);

  const cancel = () => {
    setArmed(false);
    setSticky(false);
  };

  /** Copies the selection's formatting; false when there is none. */
  const copy = async (): Promise<boolean> => {
    const slide = session.currentSlide();
    if (!slide) return false;
    const edit = editor.editing();
    if (edit) {
      const caret = edit.selection.focus;
      const from = before(edit.selection.anchor, caret)
        ? edit.selection.anchor
        : caret;
      const paragraph = edit.layout?.styles[from.paragraph];
      const run = paragraph && runAt(paragraph, from.offset);
      if (!run) return false;
      setSource({ slide: slide.id, shape: edit.shape, look: false, run });
      return true;
    }
    const shape = editor.selectedShape();
    if (!shape || shape.kind === 'table' || shape.kind === 'chart')
      return false;
    const layout = shape.textEditable
      ? await engine.textLayout(slide.index, shape.id).catch(() => null)
      : null;
    const paragraph = layout?.styles[0];
    setSource({
      slide: slide.id,
      shape: shape.id,
      look: shape.kind !== 'group',
      run: paragraph && runAt(paragraph, 0),
      paragraph,
      paragraphs: layout?.styles,
    });
    return true;
  };

  /** Copies the selection's formatting and arms the painter. */
  const arm = async (keep: boolean) => {
    if (!(await copy())) return;
    setArmed(true);
    setSticky(keep);
  };

  const done = () => {
    if (!sticky()) cancel();
  };

  /** Paints whole shapes (a click on the stage while loaded). */
  const paintShapes = async (
    shapes: { id: number; textEditable: boolean }[]
  ) => {
    const from = source();
    const slide = session.currentSlide();
    if (!from || !slide) return;
    const targets = shapes.filter(
      (s) => !(s.id === from.shape && slide.id === from.slide)
    );
    const ops = paintShapesOps(from, slide.id, targets);
    if (ops.length > 0) await session.apply(ops);
    done();
  };

  /** Paints the edited text's selection, if it is a range. */
  const paintSelection = async (): Promise<boolean> => {
    const from = source();
    const slide = session.currentSlide();
    const edit = editor.editing();
    if (!from || !slide || !edit) return false;
    const { anchor, focus } = edit.selection;
    if (anchor.paragraph === focus.paragraph && anchor.offset === focus.offset)
      return false;
    const [start, end] = before(anchor, focus)
      ? [anchor, focus]
      : [focus, anchor];
    const ops = paintRangeOps(from, {
      slide: slide.id,
      shape: edit.shape,
      start,
      end,
      cell: edit.cell,
    });
    if (ops.length > 0) await session.apply(ops);
    done();
    return true;
  };

  /** Pastes copied formatting onto the selection (text range or shapes). */
  const pasteToSelection = async () => {
    if (!source()) return;
    const sticks = sticky();
    setSticky(true);
    try {
      if (await paintSelection()) return;
      const edit = editor.editing();
      const shapes = edit
        ? [editor.findShape(edit.shape)].filter((s) => s !== undefined)
        : editor.selection();
      await paintShapes(shapes);
    } finally {
      setSticky(sticks);
    }
  };

  return {
    /** Whether clicks paint. */
    active: armed,
    sticky,
    copy,
    arm,
    cancel,
    paintShapes,
    paintSelection,
    pasteToSelection,
  };
}

export type FormatPainter = ReturnType<typeof createFormatPainter>;
