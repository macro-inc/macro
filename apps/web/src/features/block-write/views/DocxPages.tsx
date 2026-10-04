import type { CaretRect, EditOp, PageRect, Pos } from '@core/docx-engine/types';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { keyAction } from '../core/keymap';
import { type DocxEditor, PX_PER_PT } from '../primitives/create-docx-editor';

/** Space between pages (CSS pixels). */
export const PAGE_GAP = 16;

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform);

/** Where pages sit in the column (CSS pixels at the current zoom). */
export function pageGeometry(editor: DocxEditor) {
  return createMemo(() => {
    const scale = editor.zoom() * PX_PER_PT;
    const pages = editor.pages();
    const width = Math.max(1, ...pages.map((p) => p.width * scale));
    let top = 0;
    const boxes = pages.map((p) => {
      const box = {
        left: (width - p.width * scale) / 2,
        top,
        width: p.width * scale,
        height: p.height * scale,
      };
      top += box.height + PAGE_GAP;
      return box;
    });
    return { scale, width, height: Math.max(0, top - PAGE_GAP), boxes };
  });
}

export type PageGeometry = ReturnType<ReturnType<typeof pageGeometry>>;

/** A page rectangle in column coordinates. */
export function toColumn(geometry: PageGeometry, r: PageRect) {
  const box = geometry.boxes[r.page];
  if (!box) return undefined;
  return {
    left: box.left + r.x * geometry.scale,
    top: box.top + r.y * geometry.scale,
    width: r.w * geometry.scale,
    height: r.h * geometry.scale,
  };
}

function caretBox(geometry: PageGeometry, c: CaretRect) {
  return toColumn(geometry, {
    page: c.page,
    x: c.x,
    y: c.y,
    w: 0,
    h: c.height,
  });
}

function Page(props: {
  editor: DocxEditor;
  index: number;
  box: { left: number; top: number; width: number; height: number };
  root: HTMLElement | undefined;
}) {
  let element!: HTMLDivElement;
  const [near, setNear] = createSignal(false);
  // Only pages near the viewport hold a canvas (a page bitmap is megabytes).
  createEffect(() => {
    const root = props.root;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setNear(entry.isIntersecting);
        props.editor.renderer.setVisible(props.index, entry.isIntersecting);
      },
      { root, rootMargin: '100% 0px' }
    );
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      props.editor.renderer.setVisible(props.index, false);
    });
  });
  return (
    <div
      ref={element}
      class="docx-sheet absolute overflow-hidden rounded-[2px] shadow-md"
      data-docx-page={props.index}
      style={{
        left: `${props.box.left}px`,
        top: `${props.box.top}px`,
        width: `${props.box.width}px`,
        height: `${props.box.height}px`,
      }}
    >
      <Show when={near()}>
        <canvas
          ref={(canvas) => {
            props.editor.renderer.attach(props.index, canvas);
            onCleanup(() =>
              props.editor.renderer.attach(props.index, undefined)
            );
          }}
          class="block size-full"
        />
      </Show>
    </div>
  );
}

export type DocxPagesProps = {
  editor: DocxEditor;
  /** The scrolling element (for page visibility and caret scrolling). */
  scroller: HTMLElement | undefined;
  editable: boolean;
  /** Extra overlays drawn above the pages (comment highlights, peers). */
  overlay?: (geometry: Accessor<PageGeometry>) => JSX.Element;
  /** A click on the text (after the caret moved there). */
  onTextClick?: (pos: Pos) => void;
  /** Start a comment (keyboard shortcut). */
  onComment?: () => void;
  /** Called with the input element once mounted (focus management). */
  inputRef?: (input: HTMLTextAreaElement) => void;
};

/**
 * The pages of a document drawn by the engine, with the selection, caret
 * and an invisible text input that receives typing, IME composition and
 * clipboard events.
 */
export function DocxPages(props: DocxPagesProps) {
  const editor = props.editor;
  const geometry = pageGeometry(editor);
  let column!: HTMLDivElement;
  let input!: HTMLTextAreaElement;
  const [focused, setFocused] = createSignal(false);
  const [composing, setComposing] = createSignal<string | null>(null);
  /** Kept current so a copy can fill the clipboard synchronously. */
  let selectedText = '';

  const caret = createMemo(() => {
    const c = editor.state()?.caret;
    return c ? caretBox(geometry(), c) : undefined;
  });

  const rects = createMemo(() =>
    (editor.state()?.rects ?? [])
      .map((r) => toColumn(geometry(), r))
      .filter((r) => r !== undefined)
  );

  // Prefetch the selected text for the clipboard.
  createEffect(() => {
    const selection = editor.state()?.selection;
    if (
      !selection ||
      (selection.anchor.block === selection.focus.block &&
        selection.anchor.offset === selection.focus.offset)
    ) {
      selectedText = '';
      return;
    }
    editor
      .selectedText()
      .then((text) => {
        selectedText = text;
      })
      .catch(() => {});
  });

  // Keep the caret in view after keyboard edits and moves.
  let followCaret = false;
  createEffect(() => {
    const c = caret();
    const scroller = props.scroller;
    if (!c || !scroller || !followCaret) return;
    followCaret = false;
    const columnTop =
      column.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    const top = columnTop + c.top;
    const bottom = top + c.height;
    const margin = 40;
    if (top < scroller.scrollTop + margin)
      scroller.scrollTop = Math.max(0, top - margin);
    else if (bottom > scroller.scrollTop + scroller.clientHeight - margin)
      scroller.scrollTop = bottom - scroller.clientHeight + margin;
  });

  const run = (ops: EditOp[], group?: string) => {
    followCaret = true;
    editor.run(ops, group);
  };

  /** The page and point (in points) under a client position. */
  function pointAt(clientX: number, clientY: number) {
    const bounds = column.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    const g = geometry();
    let index = g.boxes.findIndex((b) => y < b.top + b.height + PAGE_GAP / 2);
    if (index < 0) index = g.boxes.length - 1;
    const box = g.boxes[index];
    if (!box) return undefined;
    return {
      page: index,
      x: (x - box.left) / g.scale,
      y: Math.min(Math.max(0, (y - box.top) / g.scale), box.height / g.scale),
    };
  }

  let dragAnchor: Pos | undefined;
  let dragFrame = 0;

  async function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    const pos = await editor.hitTest(point.page, point.x, point.y);
    if (!pos) return;
    if (event.detail === 2) {
      editor.run([{ op: 'selectWord', at: pos }]);
      return;
    }
    if (event.detail >= 3) {
      editor.run([{ op: 'selectParagraph', at: pos }]);
      return;
    }
    const current = editor.state()?.selection;
    const anchor = event.shiftKey && current ? current.anchor : pos;
    editor.run([{ op: 'select', anchor, focus: pos }]);
    dragAnchor = anchor;
    column.setPointerCapture(event.pointerId);
    if (!event.shiftKey) props.onTextClick?.(pos);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragAnchor) return;
    const anchor = dragAnchor;
    const { clientX, clientY } = event;
    cancelAnimationFrame(dragFrame);
    dragFrame = requestAnimationFrame(async () => {
      const point = pointAt(clientX, clientY);
      if (!point) return;
      const pos = await editor.hitTest(point.page, point.x, point.y);
      if (pos && dragAnchor) editor.run([{ op: 'select', anchor, focus: pos }]);
    });
  }

  function onPointerUp(event: PointerEvent) {
    dragAnchor = undefined;
    if (column.hasPointerCapture(event.pointerId))
      column.releasePointerCapture(event.pointerId);
  }

  async function pageMove(forward: boolean, extend: boolean) {
    const c = editor.state()?.caret;
    const scroller = props.scroller;
    if (!c || !scroller) return;
    const box = caretBox(geometry(), c);
    if (!box) return;
    const delta = scroller.clientHeight * 0.9 * (forward ? 1 : -1);
    const bounds = column.getBoundingClientRect();
    const point = pointAt(
      bounds.left + box.left,
      bounds.top + box.top + box.height / 2 + delta
    );
    if (!point) return;
    const pos = await editor.hitTest(point.page, point.x, point.y);
    const selection = editor.state()?.selection;
    if (!pos || !selection) return;
    scroller.scrollTop += delta;
    editor.run([
      { op: 'select', anchor: extend ? selection.anchor : pos, focus: pos },
    ]);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (composing() !== null || event.isComposing) return;
    const action = keyAction(event, isMac);
    if (!action) return;
    event.preventDefault();
    switch (action.kind) {
      case 'ops':
        run(action.ops, action.group);
        break;
      case 'undo':
        void editor.undo();
        break;
      case 'redo':
        void editor.redo();
        break;
      case 'comment':
        props.onComment?.();
        break;
      case 'page':
        void pageMove(action.forward, action.extend);
        break;
      case 'tab': {
        const state = editor.state();
        const selection = state?.selection;
        const spans =
          selection && selection.anchor.block !== selection.focus.block;
        const atListStart = state?.format.list && selection?.focus.offset === 0;
        if (spans || atListStart || !action.forward)
          run([{ op: 'indent', forward: action.forward }]);
        else run([{ op: 'insertText', text: '\t' }], 'typing');
        break;
      }
    }
  }

  function typeText(text: string) {
    if (!text) return;
    run([{ op: 'insertText', text }], 'typing');
  }

  function onInput(event: InputEvent) {
    if (composing() !== null || event.isComposing) return;
    const value = input.value;
    input.value = '';
    // Mobile keyboards send Enter and Backspace as input events.
    if (
      event.inputType === 'insertParagraph' ||
      event.inputType === 'insertLineBreak'
    ) {
      run([{ op: 'insertParagraph' }]);
      return;
    }
    if (event.inputType === 'deleteContentBackward') {
      run([{ op: 'delete', forward: false }], 'delete');
      return;
    }
    typeText(value.replace(/\r\n?/g, '\n'));
  }

  function onPaste(event: ClipboardEvent) {
    event.preventDefault();
    if (!props.editable) return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text) run([{ op: 'insertText', text: text.replace(/\r\n?/g, '\n') }]);
  }

  function onCopy(event: ClipboardEvent) {
    event.preventDefault();
    event.clipboardData?.setData('text/plain', selectedText);
  }

  function onCut(event: ClipboardEvent) {
    onCopy(event);
    if (props.editable && selectedText) run([{ op: 'delete', forward: false }]);
  }

  // Blink the caret only while the input has focus and nothing is selected.
  const showCaret = () => focused() && rects().length === 0;

  return (
    <div
      ref={column}
      class="relative mx-auto"
      style={{
        width: `${geometry().width}px`,
        height: `${geometry().height}px`,
      }}
      onPointerDown={(e) => void onPointerDown(e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-docx-pages
    >
      <For each={editor.pages()}>
        {(_, index) => (
          <Show when={geometry().boxes[index()]}>
            {(box) => (
              <Page
                editor={editor}
                index={index()}
                box={box()}
                root={props.scroller}
              />
            )}
          </Show>
        )}
      </For>
      <div class="pointer-events-none absolute inset-0" data-docx-overlay>
        <For each={rects()}>
          {(r) => (
            <div
              class="docx-selection absolute"
              style={{
                left: `${r.left}px`,
                top: `${r.top}px`,
                width: `${r.width}px`,
                height: `${r.height}px`,
              }}
            />
          )}
        </For>
        {props.overlay?.(geometry)}
        <Show when={caret()}>
          {(c) => (
            <>
              <Show when={showCaret()}>
                <div
                  class="docx-caret absolute w-px"
                  data-docx-caret
                  style={{
                    left: `${c().left}px`,
                    top: `${c().top}px`,
                    height: `${c().height}px`,
                  }}
                />
              </Show>
              <Show when={composing()}>
                {(text) => (
                  <span
                    class="docx-composition absolute whitespace-pre"
                    style={{
                      left: `${c().left}px`,
                      top: `${c().top}px`,
                      'font-size': `${c().height * 0.8}px`,
                      'line-height': `${c().height}px`,
                    }}
                  >
                    {text()}
                  </span>
                )}
              </Show>
            </>
          )}
        </Show>
      </div>
      <textarea
        ref={(el) => {
          input = el;
          props.inputRef?.(el);
        }}
        class="absolute resize-none overflow-hidden border-0 bg-transparent p-0 opacity-0 outline-none"
        style={{
          left: `${caret()?.left ?? 0}px`,
          top: `${caret()?.top ?? 0}px`,
          width: '2px',
          height: `${Math.max(caret()?.height ?? 16, 16)}px`,
          'font-size': '16px',
        }}
        aria-label="Document text"
        aria-multiline="true"
        readOnly={!props.editable}
        autocapitalize="off"
        autocomplete="off"
        spellcheck={false}
        data-docx-input
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onInput={(e) => onInput(e as InputEvent)}
        onCompositionStart={() => setComposing('')}
        onCompositionUpdate={(e) => setComposing(e.data)}
        onCompositionEnd={(e) => {
          setComposing(null);
          input.value = '';
          typeText(e.data);
        }}
        onPaste={onPaste}
        onCopy={onCopy}
        onCut={onCut}
      />
    </div>
  );
}
