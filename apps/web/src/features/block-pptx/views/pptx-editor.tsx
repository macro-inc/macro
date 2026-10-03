/**
 * The presentation editor: slide rail, toolbar, the slide stage with
 * selection and in-place text editing, and speaker notes.
 */

import type { ShapeOutline, SlideOutline } from '@core/pptx-engine/types';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { EditorToolbar } from '../components/editor-toolbar';
import { NotesPanel } from '../components/notes-panel';
import { SelectionOverlay } from '../components/selection-overlay';
import { SlideRail } from '../components/slide-rail';
import { SlideStage } from '../components/slide-stage';
import { usePptxEditorContext } from '../context/pptx-editor-context';
import { caretSegment, selectionQuads } from '../core/caret';
import { formatState, stepFontSize } from '../core/formatting';
import { boxOf, hitTest, type Point } from '../core/geometry';
import { STANDARD_SWATCHES, themeSwatches } from '../core/palette';
import { formatCommand, paragraphCommand } from '../core/text-commands';
import { createPresentationSession } from '../primitives/create-presentation-session';
import { createRenderQueue } from '../primitives/create-render-queue';
import { createSlideEditor } from '../primitives/create-slide-editor';
import { createThumbnails } from '../primitives/create-thumbnails';

const STAGE_MARGIN = 32;

/** Pixel widths are rounded up so small resizes reuse renders. */
const quantize = (px: number) =>
  Math.min(4096, Math.max(256, Math.ceil(px / 64) * 64));

async function fileToBase64(file: Blob): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

interface CellEdit {
  shape: ShapeOutline;
  row: number;
  col: number;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
}

/** The cell of a table frame under `p` (slide coordinates). */
function tableCellAt(
  shape: ShapeOutline,
  p: Point
): Omit<CellEdit, 'text' | 'shape'> | null {
  const table = shape.table;
  if (!table) return null;
  const totalW = table.columnWidths.reduce((a, b) => a + b, 0) || shape.w;
  const totalH = table.rowHeights.reduce((a, b) => a + b, 0) || shape.h;
  // Rows grow with their text; spread the frame's height proportionally.
  const sy = shape.h / totalH;
  const sx = shape.w / totalW;
  let y = shape.y;
  for (let r = 0; r < table.rowHeights.length; r++) {
    const h = table.rowHeights[r] * sy;
    let x = shape.x;
    for (let c = 0; c < table.columnWidths.length; c++) {
      const w = table.columnWidths[c] * sx;
      if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) {
        return { row: r, col: c, rect: { x, y, w, h } };
      }
      x += w;
    }
    y += h;
  }
  return null;
}

export function PptxEditor() {
  const context = usePptxEditorContext();
  const { engine } = context;
  const readonly = () => !context.canEdit();

  const session = createPresentationSession({
    engine,
    persist: context.persist,
    canEdit: context.canEdit,
    notifyError: context.notifyError,
  });
  const [loadError, setLoadError] = createSignal<string>();
  void session.refresh().catch((e: unknown) => {
    setLoadError(e instanceof Error ? e.message : String(e));
  });

  const queue = createRenderQueue();
  const dpr = () =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  // ---- stage geometry --------------------------------------------------

  let stageHost!: HTMLDivElement;
  const [hostSize, setHostSize] = createSignal({ w: 0, h: 0 });
  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setHostSize({ w: r.width, h: r.height });
    });
    observer.observe(stageHost);
    onCleanup(() => observer.disconnect());
  });

  const slideW = () => session.outline()?.width ?? 960;
  const slideH = () => session.outline()?.height ?? 540;
  /** CSS pixels per point. */
  const scale = () => {
    const { w, h } = hostSize();
    if (w <= 0 || h <= 0) return 0;
    return Math.max(
      0.05,
      Math.min(
        (w - 2 * STAGE_MARGIN) / slideW(),
        (h - 2 * STAGE_MARGIN) / slideH()
      )
    );
  };
  const renderWidth = createMemo(() =>
    scale() > 0 ? quantize(slideW() * scale() * dpr()) : 0
  );

  const editor = createSlideEditor({
    engine,
    session,
    queue,
    canEdit: context.canEdit,
    renderWidth,
    pointsPerPixel: () => 1 / Math.max(scale(), 0.01),
  });

  const thumbnails = createThumbnails({
    engine,
    session,
    queue,
    width: () => Math.round(150 * dpr()),
  });

  // ---- text input ------------------------------------------------------

  let input!: HTMLTextAreaElement;
  let stage!: HTMLDivElement;
  const focusInput = () => input?.focus({ preventScroll: true });
  const focusStage = () => stage?.focus({ preventScroll: true });

  const startEditing = async (shape: number, at?: Point) => {
    await editor.startEditing(shape, at);
    focusInput();
  };
  const stopEditing = () => {
    editor.stopEditing();
    focusStage();
  };

  const toSlide = (e: { clientX: number; clientY: number }): Point => {
    const rect = stage.getBoundingClientRect();
    const s = scale() || 1;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s };
  };

  // ---- table cells -----------------------------------------------------

  const [cellEdit, setCellEdit] = createSignal<CellEdit | null>(null);
  const commitCell = async (value: string) => {
    const edit = cellEdit();
    const slide = session.currentSlide();
    setCellEdit(null);
    if (!edit || !slide || value === edit.text) return;
    await session.apply([
      {
        op: 'setCellText',
        slide: slide.id,
        shape: edit.shape.id,
        row: edit.row,
        col: edit.col,
        text: value,
      },
    ]);
  };

  // ---- pointer ---------------------------------------------------------

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (cellEdit())
      void commitCell(
        (document.getElementById('pptx-cell-input') as HTMLTextAreaElement)
          ?.value ?? ''
      );
    editor.pointerDown(toSlide(e), { shift: e.shiftKey, detail: e.detail });
    stage.setPointerCapture(e.pointerId);
    if (editor.editing()) {
      e.preventDefault();
      focusInput();
    } else {
      focusStage();
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!stage.hasPointerCapture(e.pointerId)) return;
    editor.pointerMove(toSlide(e), { shift: e.shiftKey });
  };

  const onPointerUp = (e: PointerEvent) => {
    if (stage.hasPointerCapture(e.pointerId))
      stage.releasePointerCapture(e.pointerId);
    void editor.pointerUp();
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (readonly()) return;
    const at = toSlide(e);
    const slide = session.currentSlide();
    const hit = slide ? hitTest(slide.shapes, at) : undefined;
    if (!hit || editor.editing()) return;
    if (hit.kind === 'table' && hit.table) {
      const cell = tableCellAt(hit, at);
      if (cell)
        setCellEdit({
          ...cell,
          shape: hit,
          text: hit.table.rows[cell.row]?.[cell.col] ?? '',
        });
      return;
    }
    if (hit.textEditable) void startEditing(hit.id, at);
  };

  // ---- keyboard --------------------------------------------------------

  const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

  const undo = async () => {
    if (editor.editing()) editor.stopEditing();
    await session.undo();
  };
  const redo = async () => {
    if (editor.editing()) editor.stopEditing();
    await session.redo();
  };

  const onStageKeyDown = (e: KeyboardEvent) => {
    if (e.target === input) return;
    const key = e.key;
    if (isMod(e) && key.toLowerCase() === 'z') {
      e.preventDefault();
      void (e.shiftKey ? redo() : undo());
      return;
    }
    if (isMod(e) && key.toLowerCase() === 'y') {
      e.preventDefault();
      void redo();
      return;
    }
    if (isMod(e) && key.toLowerCase() === 's') {
      e.preventDefault();
      void session.save().catch(() => {});
      return;
    }
    if (key === 'PageDown' || key === 'PageUp') {
      e.preventDefault();
      editor.goToSlide(session.slideIndex() + (key === 'PageDown' ? 1 : -1));
      return;
    }
    const shape = editor.selectedShape();
    if (!shape) return;
    if (key === 'Escape') {
      e.preventDefault();
      editor.select(null);
    } else if (readonly()) {
      return;
    } else if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      void editor.deleteSelected();
    } else if (key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      void editor.nudge(dx, dy);
    } else if (isMod(e) && key.toLowerCase() === 'd') {
      e.preventDefault();
      void editor.duplicateSelected();
    } else if ((key === 'Enter' || key === 'F2') && shape.textEditable) {
      e.preventDefault();
      void startEditing(shape.id);
    }
  };

  const onInputKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const key = e.key;
    const mod = isMod(e);
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === 'Escape') {
      handled();
      stopEditing();
    } else if (key === 'Enter') {
      handled();
      void editor.typeText(e.shiftKey ? '\u000b' : '\n');
    } else if (key === 'Backspace' || key === 'Delete') {
      handled();
      const unit = e.metaKey ? 'line' : e.altKey || e.ctrlKey ? 'word' : 'char';
      void editor.deleteText(key === 'Backspace' ? -1 : 1, unit);
    } else if (key.startsWith('Arrow') || key === 'Home' || key === 'End') {
      handled();
      const dir = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
        Home: 'home',
        End: 'end',
      } as const;
      void editor.moveCaret(dir[key as keyof typeof dir], {
        extend: e.shiftKey,
        word: e.altKey || e.ctrlKey,
        line: e.metaKey,
      });
    } else if (key === 'Tab') {
      handled();
      const level = textFormatLevel();
      void editor.formatWith((t, range) =>
        paragraphCommand(t, range ?? null, {
          level: Math.max(0, Math.min(8, level + (e.shiftKey ? -1 : 1))),
        })
      );
    } else if (mod && key.toLowerCase() === 'a') {
      handled();
      editor.selectAllText();
    } else if (mod && ['b', 'i', 'u'].includes(key.toLowerCase())) {
      handled();
      toggle(
        ({ b: 'bold', i: 'italic', u: 'underline' } as const)[
          key.toLowerCase() as 'b' | 'i' | 'u'
        ]
      );
    } else if (mod && key.toLowerCase() === 'z') {
      handled();
      void (e.shiftKey ? redo() : undo());
    } else if (mod && key.toLowerCase() === 'y') {
      handled();
      void redo();
    } else if (mod && key.toLowerCase() === 's') {
      handled();
      void session.save().catch(() => {});
    }
  };

  const onBeforeInput = (e: InputEvent) => {
    if (e.isComposing || e.inputType === 'insertCompositionText') return;
    e.preventDefault();
    const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? '';
    if (e.inputType.startsWith('insert') && text) void editor.typeText(text);
  };

  const onCompositionEnd = (e: CompositionEvent) => {
    if (e.data) void editor.typeText(e.data);
    input.value = '';
  };

  const onCopy = (e: ClipboardEvent) => {
    e.preventDefault();
    e.clipboardData?.setData('text/plain', editor.selectedText());
  };
  const onCut = (e: ClipboardEvent) => {
    onCopy(e);
    void editor.deleteText(-1);
  };
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain');
    if (text) void editor.typeText(text);
  };

  // ---- formatting ------------------------------------------------------

  const format = () => {
    const src = editor.formatSource();
    return formatState(src.layout, src.range);
  };
  const textFormatLevel = () => {
    const src = editor.formatSource();
    const p = src.range?.[0].paragraph ?? 0;
    return src.layout?.styles[p]?.level ?? 0;
  };
  const textActive = () =>
    !!editor.editing() || !!editor.selectedShape()?.textEditable;
  const afterFormat = () => {
    if (editor.editing()) focusInput();
  };
  function toggle(key: 'bold' | 'italic' | 'underline') {
    const current = format()[key];
    void editor
      .formatWith((t, range) => formatCommand(t, range, { [key]: !current }))
      .then(afterFormat);
  }
  const fontSize = (dir: 1 | -1) => {
    const size = stepFontSize(format().size ?? 18, dir);
    void editor
      .formatWith((t, range) => formatCommand(t, range, { size }))
      .then(afterFormat);
  };
  const textColor = (color: string) =>
    void editor
      .formatWith((t, range) => formatCommand(t, range, { color }))
      .then(afterFormat);
  const align = (value: 'left' | 'center' | 'right') =>
    void editor
      .formatWith((t, range) => paragraphCommand(t, range, { align: value }))
      .then(afterFormat);
  const toggleBullets = () => {
    const on = format().bullet;
    void editor
      .formatWith((t, range) =>
        paragraphCommand(t, range, {
          bullet: on ? { kind: 'none' } : { kind: 'char', char: '•' },
        })
      )
      .then(afterFormat);
  };
  const fill = (color: string | null) => {
    const shape = editor.selectedShape();
    const slide = session.currentSlide();
    if (!shape || !slide) return;
    void session.apply([
      {
        op: 'setFill',
        slide: slide.id,
        shape: shape.id,
        fill: color ? { kind: 'solid', color } : { kind: 'none' },
      },
    ]);
  };

  // ---- insertion -------------------------------------------------------

  const insert = async (shape: Parameters<typeof session.apply>[0][number]) => {
    const result = await session.apply([shape]);
    return result?.created[0]?.shape;
  };
  const centered = (w: number, h: number) => ({
    x: (slideW() - w) / 2,
    y: (slideH() - h) / 2,
    w,
    h,
  });

  const insertTextBox = async () => {
    const slide = session.currentSlide();
    if (!slide) return;
    const id = await insert({
      op: 'addShape',
      slide: slide.id,
      shape: { kind: 'textBox', text: '' },
      ...centered(300, 40),
    });
    if (id !== undefined) void startEditing(id);
  };
  const insertShape = async (preset: string) => {
    const slide = session.currentSlide();
    if (!slide) return;
    const id = await insert({
      op: 'addShape',
      slide: slide.id,
      shape: { kind: 'shape', preset },
      ...centered(200, 120),
    });
    if (id !== undefined) editor.select(id);
    focusStage();
  };
  const insertImage = async (file: File) => {
    const slide = session.currentSlide();
    if (!slide) return;
    try {
      const bitmap = await createImageBitmap(file);
      const natural = { w: bitmap.width * 0.75, h: bitmap.height * 0.75 };
      bitmap.close();
      const fit = Math.min(
        1,
        (slideW() * 0.6) / natural.w,
        (slideH() * 0.6) / natural.h
      );
      const data = await fileToBase64(file);
      const id = await insert({
        op: 'addShape',
        slide: slide.id,
        shape: { kind: 'image', data, description: file.name },
        ...centered(natural.w * fit, natural.h * fit),
      });
      if (id !== undefined) editor.select(id);
    } catch {
      context.notifyError('That picture could not be inserted.');
    }
  };
  const insertTable = async () => {
    const slide = session.currentSlide();
    if (!slide) return;
    const cells = [
      ['Item', 'Q1', 'Q2'],
      ['', '', ''],
      ['', '', ''],
    ];
    const id = await insert({
      op: 'addShape',
      slide: slide.id,
      shape: { kind: 'table', cells },
      ...centered(slideW() * 0.6, 90),
    });
    if (id !== undefined) editor.select(id);
  };

  // ---- slides ----------------------------------------------------------

  const goToSlideId = (id: number) => {
    const index = session.outline()?.slides.findIndex((s) => s.id === id) ?? -1;
    if (index >= 0) editor.goToSlide(index);
  };
  const addSlide = async () => {
    const current = session.currentSlide();
    const result = await session.apply([
      { op: 'addSlide', after: current?.id },
    ]);
    const id = result?.created[0]?.slide;
    if (id !== undefined) goToSlideId(id);
  };
  const duplicateSlide = async (id: number) => {
    const result = await session.apply([{ op: 'duplicateSlide', slide: id }]);
    const created = result?.created[0]?.slide;
    if (created !== undefined) goToSlideId(created);
  };
  const deleteSlide = async (id: number) => {
    editor.goToSlide(session.slideIndex());
    await session.apply([{ op: 'deleteSlide', slide: id }]);
  };
  const toggleHidden = (slide: SlideOutline) =>
    void session.apply([
      { op: 'setSlideHidden', slide: slide.id, hidden: !slide.hidden },
    ]);
  const moveSlide = async (id: number, to: number) => {
    await session.apply([{ op: 'moveSlide', slide: id, to }]);
    goToSlideId(id);
  };

  const download = async () => {
    try {
      context.download(await engine.save(), context.fileName());
    } catch {
      context.notifyError('The presentation could not be exported.');
    }
  };

  // ---- overlay geometry --------------------------------------------------

  const overlay = () => {
    const edit = editor.editing();
    const d = editor.drag();
    const shape = editor.selectedShape();
    return {
      selection: shape ? boxOf(shape) : undefined,
      preview:
        d?.active && d.kind !== 'move'
          ? editor.dragPreview(d)
          : d?.active && !editor.images().layer
            ? editor.dragPreview(d)
            : undefined,
      caret:
        edit?.layout &&
        edit.selection.anchor.paragraph === edit.selection.focus.paragraph &&
        edit.selection.anchor.offset === edit.selection.focus.offset
          ? (caretSegment(edit.layout, edit.selection.focus) ?? undefined)
          : undefined,
      textSelection: edit?.layout
        ? selectionQuads(
            edit.layout,
            edit.selection.anchor,
            edit.selection.focus
          )
        : undefined,
    };
  };

  // Keep the hidden input next to the caret so IME candidate windows appear there.
  const inputPosition = () => {
    const caret = overlay().caret;
    const s = scale();
    return caret
      ? { left: `${caret[0].x * s}px`, top: `${caret[0].y * s}px` }
      : { left: '0px', top: '0px' };
  };

  // Leaving a slide ends text editing and closes the cell editor.
  createEffect(
    on(session.slideIndex, () => setCellEdit(null), { defer: true })
  );

  const swatches = () => [
    ...themeSwatches(session.outline()?.themeColors ?? []),
    ...STANDARD_SWATCHES,
  ];

  return (
    <div
      class="flex size-full min-h-0 flex-col bg-page"
      data-testid="pptx-editor"
    >
      <EditorToolbar
        readonly={readonly()}
        canUndo={session.history().canUndo}
        canRedo={session.history().canRedo}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        onInsertTextBox={() => void insertTextBox()}
        onInsertShape={(p) => void insertShape(p)}
        onInsertImage={(f) => void insertImage(f)}
        onInsertTable={() => void insertTable()}
        textActive={textActive()}
        format={format()}
        onToggle={toggle}
        onFontSize={fontSize}
        onTextColor={textColor}
        onAlign={align}
        onToggleBullets={toggleBullets}
        shapeActive={!!editor.selectedShape() && !editor.editing()}
        onFill={fill}
        swatches={swatches()}
        saveState={session.saveState()}
        onSave={() => void session.save().catch(() => {})}
        onDownload={() => void download()}
        keepFocus={!!editor.editing()}
      />
      <div class="flex min-h-0 flex-1">
        <Show when={session.outline()}>
          {(deck) => (
            <SlideRail
              slides={deck().slides}
              current={session.slideIndex()}
              aspect={slideH() / slideW()}
              thumbnail={thumbnails.thumbnail}
              thumbnailPixels={Math.round(150 * dpr())}
              readonly={readonly()}
              onSelect={(i) => editor.goToSlide(i)}
              onMove={(id, to) => void moveSlide(id, to)}
              onAdd={() => void addSlide()}
              onDuplicate={(id) => void duplicateSlide(id)}
              onDelete={(id) => void deleteSlide(id)}
              onToggleHidden={toggleHidden}
            />
          )}
        </Show>
        <div class="flex min-w-0 flex-1 flex-col">
          <div
            ref={stageHost}
            class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-inset"
          >
            <Show
              when={session.outline() && scale() > 0}
              fallback={
                <div class="text-ink-muted text-sm" data-testid="pptx-loading">
                  {loadError()
                    ? `This presentation could not be opened: ${loadError()}`
                    : 'Opening presentation…'}
                </div>
              }
            >
              <SlideStage
                images={editor.images()}
                cssWidth={slideW() * scale()}
                cssHeight={slideH() * scale()}
                pixelWidth={renderWidth()}
                pixelsPerPoint={renderWidth() / slideW()}
              >
                <div
                  ref={stage}
                  tabIndex={0}
                  data-testid="pptx-stage"
                  class="absolute inset-0 outline-none"
                  classList={{ 'cursor-text': !!editor.editing() }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => editor.cancelDrag()}
                  onDblClick={onDoubleClick}
                  onKeyDown={onStageKeyDown}
                >
                  <SelectionOverlay
                    width={slideW()}
                    height={slideH()}
                    unit={1 / Math.max(scale(), 0.01)}
                    selection={overlay().selection}
                    showHandles={!readonly()}
                    preview={overlay().preview}
                    caret={overlay().caret}
                    textSelection={overlay().textSelection}
                    editing={!!editor.editing()}
                    onHandleDown={(kind, handle, e) => {
                      e.stopPropagation();
                      stage.setPointerCapture(e.pointerId);
                      editor.handleDown(kind, handle, toSlide(e));
                    }}
                  />
                  <textarea
                    ref={input}
                    data-testid="pptx-text-input"
                    aria-label="Slide text"
                    class="pointer-events-none absolute h-4 w-px resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0 outline-none"
                    style={inputPosition()}
                    autocomplete="off"
                    spellcheck={false}
                    onKeyDown={onInputKeyDown}
                    onBeforeInput={onBeforeInput}
                    onCompositionEnd={onCompositionEnd}
                    onCopy={onCopy}
                    onCut={onCut}
                    onPaste={onPaste}
                  />
                  <Show when={cellEdit()}>
                    {(cell) => (
                      <textarea
                        id="pptx-cell-input"
                        data-testid="pptx-cell-input"
                        class="absolute z-10 resize-none rounded-sm border-2 border-accent bg-surface p-1 text-ink text-sm shadow-lg outline-none"
                        style={{
                          left: `${cell().rect.x * scale()}px`,
                          top: `${cell().rect.y * scale()}px`,
                          width: `${Math.max(80, cell().rect.w * scale())}px`,
                          height: `${Math.max(32, cell().rect.h * scale())}px`,
                        }}
                        value={cell().text}
                        ref={(el) => queueMicrotask(() => el.focus())}
                        onPointerDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void commitCell(e.currentTarget.value);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setCellEdit(null);
                          }
                        }}
                        onBlur={(e) => void commitCell(e.currentTarget.value)}
                      />
                    )}
                  </Show>
                </div>
              </SlideStage>
            </Show>
          </div>
          <Show when={session.currentSlide()}>
            {(slide) => (
              <NotesPanel
                slideId={slide().id}
                notes={slide().notes ?? ''}
                readonly={readonly()}
                onCommit={(slideId, text) => {
                  const current = session
                    .outline()
                    ?.slides.find((s) => s.id === slideId);
                  if ((current?.notes ?? '') !== text)
                    void session.apply([
                      { op: 'setNotes', slide: slideId, text },
                    ]);
                }}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
