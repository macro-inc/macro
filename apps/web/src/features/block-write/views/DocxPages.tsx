import type {
  CaretRect,
  Clip,
  EditOp,
  PageRect,
  Pos,
} from '@core/docx-engine/types';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { clipboardHtml, readClipboardHtml } from '../core/clipboard';
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
      class="docx-sheet absolute cursor-text overflow-hidden rounded-[2px] shadow-md ring-1 ring-edge-muted"
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

/**
 * While a header or footer is being edited: the body dimmed on every page,
 * a dashed edge around the header or footer area, and a label with a way
 * back to the body on the page being edited.
 */
function StoryChrome(props: {
  editor: DocxEditor;
  geometry: PageGeometry;
  onClose: () => void;
}) {
  const story = () => props.editor.state()?.story;
  const kind = () => {
    const k = story()?.kind;
    return k === 'header' || k === 'footer' ? k : undefined;
  };
  return (
    <Show when={kind()}>
      {(k) => (
        <Index each={props.editor.pages()}>
          {(page, index) => {
            const box = () => props.geometry.boxes[index];
            const scale = () => props.geometry.scale;
            const top = () => page().header?.bottom ?? 0;
            const bottom = () => page().footer?.top ?? page().height;
            const edge = () =>
              k() === 'header' ? top() * scale() : bottom() * scale();
            return (
              <Show when={box()}>
                {(b) => (
                  <>
                    <div
                      class="docx-veil absolute"
                      style={{
                        left: `${b().left}px`,
                        top: `${b().top + top() * scale()}px`,
                        width: `${b().width}px`,
                        height: `${Math.max(0, (bottom() - top()) * scale())}px`,
                      }}
                    />
                    <div
                      class="docx-story-edge absolute border-t border-dashed"
                      style={{
                        left: `${b().left}px`,
                        top: `${b().top + edge()}px`,
                        width: `${b().width}px`,
                      }}
                    />
                    <Show when={story()?.page === index}>
                      <div
                        class="pointer-events-auto absolute flex items-center gap-1 rounded-sm bg-accent px-1.5 py-0.5 text-[11px] text-accent-contrast"
                        data-docx-story-label
                        style={{
                          left: `${b().left + 8}px`,
                          top:
                            k() === 'header'
                              ? `${b().top + edge() + 2}px`
                              : `${b().top + edge() - 20}px`,
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <span>{k() === 'header' ? 'Header' : 'Footer'}</span>
                        <button
                          type="button"
                          class="rounded-sm px-1 underline-offset-2 hover:underline"
                          onClick={() => props.onClose()}
                        >
                          Close
                        </button>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            );
          }}
        </Index>
      )}
    </Show>
  );
}

/** How far (points) outside the notes' lines a click still edits a note. */
const NOTE_SLOP = 4;

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
  /** Open the find bar (keyboard shortcut), with the replace field. */
  onFind?: (replace: boolean) => void;
  /** Go to the next (or previous) match of the search. */
  onFindNext?: (forward: boolean) => void;
  /** Called with the input element once mounted (focus management). */
  inputRef?: (input: HTMLTextAreaElement) => void;
  /**
   * The document's id: content copied from the same document pastes back
   * with its pictures, links and list numbering.
   */
  documentId?: string;
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
  /**
   * The selection's clipboard content, fetched once the selection settles,
   * so a copy can fill the clipboard synchronously.
   */
  let clipboard: { key: string; clip: Clip } | undefined;
  let clipTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(clipTimer));
  const selectionKey = () =>
    JSON.stringify([editor.state()?.selection, editor.revision()]);
  const documentId = () => props.documentId ?? editor.docKey;

  const caret = createMemo(() => {
    const c = editor.state()?.caret;
    return c ? caretBox(geometry(), c) : undefined;
  });

  const rects = createMemo(() =>
    (editor.state()?.rects ?? [])
      .map((r) => toColumn(geometry(), r))
      .filter((r) => r !== undefined)
  );

  // Prefetch the clipboard content of a selection (an engine round trip).
  createEffect(() => {
    const selection = editor.state()?.selection;
    const key = selectionKey();
    clearTimeout(clipTimer);
    if (
      !selection ||
      (selection.anchor.block === selection.focus.block &&
        selection.anchor.offset === selection.focus.offset)
    ) {
      clipboard = undefined;
      return;
    }
    clipTimer = setTimeout(() => {
      editor
        .copySelection()
        .then((clip) => {
          if (selectionKey() === key) clipboard = { key, clip };
        })
        .catch(() => {});
    }, 120);
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

  // Pointer events carry no click count (`detail` is 0), so double and
  // triple clicks are counted here: quick presses close together.
  let lastPress = { time: 0, x: 0, y: 0, count: 0 };
  function clickCount(event: PointerEvent) {
    const near =
      Math.abs(event.clientX - lastPress.x) < 5 &&
      Math.abs(event.clientY - lastPress.y) < 5;
    const count =
      near && event.timeStamp - lastPress.time < 500 ? lastPress.count + 1 : 1;
    lastPress = {
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
      count,
    };
    return count;
  }

  /** The header, footer or notes area under a point (points), if any. */
  function areaAt(point: { page: number; y: number }) {
    const page = editor.pages()[point.page];
    if (page?.header && point.y < page.header.bottom)
      return { kind: 'header' as const, editable: page.header.editable };
    if (page?.footer && point.y >= page.footer.top)
      return { kind: 'footer' as const, editable: page.footer.editable };
    const notes = page?.notes;
    if (
      notes &&
      point.y >= notes.top - NOTE_SLOP &&
      point.y <= notes.bottom + NOTE_SLOP
    )
      return { kind: 'note' as const, editable: notes.editable };
    return undefined;
  }

  /**
   * A click in a footnote or endnote edits it, as in Word. Double-clicking
   * a header or footer edits it; while one is open, a click on another
   * page's header or footer moves there and a click on the body goes back
   * to it. Returns whether the click was fully handled.
   */
  async function switchStory(
    point: { page: number; x: number; y: number },
    clicks: number
  ) {
    if (!props.editable) return false;
    const story = editor.state()?.story;
    const area = areaAt(point);
    if (area?.kind === 'note') {
      // The engine enters the note under the point (keeping the selection
      // when it is already there); the press goes on to place the caret.
      run([{ op: 'enterStory', ...point }]);
      await editor.idle();
      return false;
    }
    if (!story || (story.kind !== 'header' && story.kind !== 'footer')) {
      if (clicks === 2 && area?.editable) {
        run([{ op: 'enterStory', ...point }]);
        return true;
      }
      if (story && story.kind !== 'body') {
        // Out of a note, back to the body.
        editor.run([{ op: 'exitStory' }]);
        await editor.idle();
      }
      return false;
    }
    if (area?.kind === story.kind && point.page === story.page) return false;
    if (area?.editable) {
      run([{ op: 'enterStory', ...point }]);
      return true;
    }
    editor.run([{ op: 'exitStory' }]);
    await editor.idle();
    return false;
  }

  /** Presses are handled one after another, each after the last one's
   * hit test, so a quick second click never overtakes the first. */
  let presses: Promise<void> = Promise.resolve();
  /** Whether the button is still down (a drag extends the selection). */
  let held = false;

  /**
   * A finger on the page: it scrolls natively, a tap places the caret (and
   * opens the keyboard), a double tap selects a word, and a press held
   * still selects a word and then extends the selection as it moves.
   */
  let touch:
    | {
        id: number;
        x: number;
        y: number;
        time: number;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  /** A held press is selecting: the finger extends the selection. */
  let touchSelecting = false;
  let lastTap = { time: 0, x: 0, y: 0 };
  onCleanup(() => clearTimeout(touch?.timer));

  /** Movement (CSS pixels) after which a touch is a scroll, not a tap. */
  const TAP_SLOP = 10;
  const LONG_PRESS = 500;

  function touchDown(event: PointerEvent) {
    clearTimeout(touch?.timer);
    const { clientX, clientY } = event;
    touch = {
      id: event.pointerId,
      x: clientX,
      y: clientY,
      time: event.timeStamp,
      timer: setTimeout(() => longPress(clientX, clientY), LONG_PRESS),
    };
  }

  function longPress(clientX: number, clientY: number) {
    touch = undefined;
    const point = pointAt(clientX, clientY);
    if (!point) return;
    touchSelecting = true;
    held = true;
    input.focus({ preventScroll: true });
    presses = presses
      .then(async () => {
        const pos = await editor.hitTest(point.page, point.x, point.y);
        if (!pos) return;
        editor.run([{ op: 'selectWord', at: pos }]);
        await editor.idle();
        const selection = editor.state()?.selection;
        if (held && selection) dragAnchor = selection.anchor;
      })
      .catch(() => {});
  }

  function touchUp(event: PointerEvent) {
    const t = touch;
    clearTimeout(t?.timer);
    touch = undefined;
    if (!t || t.id !== event.pointerId) return;
    const point = pointAt(t.x, t.y);
    if (!point) return;
    const double =
      event.timeStamp - lastTap.time < 350 &&
      Math.abs(t.x - lastTap.x) < 24 &&
      Math.abs(t.y - lastTap.y) < 24;
    lastTap = double
      ? { time: 0, x: 0, y: 0 }
      : { time: event.timeStamp, x: t.x, y: t.y };
    // Focus inside the tap's own handler, so mobile browsers open the
    // keyboard.
    input.focus({ preventScroll: true });
    presses = presses
      .then(() => press(point, double ? 2 : 1, false))
      .catch(() => {});
  }

  /** Ends any press or drag (also when the browser takes the pointer over
   * to scroll). */
  function release() {
    clearTimeout(touch?.timer);
    touch = undefined;
    touchSelecting = false;
    held = false;
    dragAnchor = undefined;
  }

  // While a held press selects, the finger must not scroll the page.
  onMount(() => {
    const preventScroll = (event: TouchEvent) => {
      if (touchSelecting) event.preventDefault();
    };
    column.addEventListener('touchmove', preventScroll, { passive: false });
    onCleanup(() => column.removeEventListener('touchmove', preventScroll));
  });

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'touch') {
      touchDown(event);
      return;
    }
    if (event.button !== 0) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    const clicks = clickCount(event);
    const shift = event.shiftKey;
    held = true;
    column.setPointerCapture(event.pointerId);
    presses = presses.then(() => press(point, clicks, shift)).catch(() => {});
  }

  async function press(
    point: { page: number; x: number; y: number },
    clicks: number,
    shift: boolean
  ) {
    if (await switchStory(point, clicks)) return;
    const pos = await editor.hitTest(point.page, point.x, point.y);
    if (!pos) return;
    if (clicks === 2) {
      editor.run([{ op: 'selectWord', at: pos }]);
      return;
    }
    if (clicks >= 3) {
      editor.run([{ op: 'selectParagraph', at: pos }]);
      return;
    }
    const current = editor.state()?.selection;
    const anchor = shift && current ? current.anchor : pos;
    editor.run([{ op: 'select', anchor, focus: pos }]);
    if (held) dragAnchor = anchor;
    if (!shift) props.onTextClick?.(pos);
  }

  function onPointerMove(event: PointerEvent) {
    if (
      touch &&
      touch.id === event.pointerId &&
      Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_SLOP
    ) {
      // A scroll, not a tap.
      clearTimeout(touch.timer);
      touch = undefined;
    }
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
    if (event.pointerType === 'touch' && !touchSelecting) touchUp(event);
    release();
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
    if (event.key === 'Escape' && editor.state()?.story.kind !== 'body') {
      event.preventDefault();
      run([{ op: 'exitStory' }]);
      return;
    }
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
      case 'find':
        props.onFind?.(action.replace);
        break;
      case 'findNext':
        props.onFindNext?.(action.forward);
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
    const html = event.clipboardData?.getData('text/html') ?? '';
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const rich = html ? readClipboardHtml(html, documentId()) : undefined;
    if (rich?.paragraphs.some((p) => p.runs.length)) {
      run([
        {
          op: 'paste',
          paragraphs: rich.paragraphs,
          sameDocument: rich.sameDocument,
        },
      ]);
      return;
    }
    if (text) run([{ op: 'insertText', text: text.replace(/\r\n?/g, '\n') }]);
  }

  /** Puts the selection on the clipboard; false when nothing is selected. */
  function copy(event: ClipboardEvent): boolean {
    event.preventDefault();
    const selection = editor.state()?.selection;
    if (
      !selection ||
      (selection.anchor.block === selection.focus.block &&
        selection.anchor.offset === selection.focus.offset)
    )
      return false;
    const ready = clipboard?.key === selectionKey() ? clipboard.clip : null;
    if (ready && event.clipboardData) {
      event.clipboardData.setData('text/plain', ready.text);
      event.clipboardData.setData(
        'text/html',
        clipboardHtml(ready, documentId())
      );
      return true;
    }
    // Not fetched yet: the clipboard API takes the content when it is.
    const clip = editor.copySelection();
    const blob = (type: string, data: (c: Clip) => string) =>
      clip.then((c) => new Blob([data(c)], { type }));
    void navigator.clipboard
      ?.write([
        new ClipboardItem({
          'text/plain': blob('text/plain', (c) => c.text),
          'text/html': blob('text/html', (c) => clipboardHtml(c, documentId())),
        }),
      ])
      .catch(() => {});
    return true;
  }

  function onCopy(event: ClipboardEvent) {
    copy(event);
  }

  function onCut(event: ClipboardEvent) {
    if (copy(event) && props.editable) run([{ op: 'delete', forward: false }]);
  }

  // Blink the caret only while the input has focus and nothing is selected.
  const showCaret = () => focused() && rects().length === 0;

  return (
    <div
      ref={column}
      class="relative mx-auto select-none [-webkit-touch-callout:none]"
      style={{
        width: `${geometry().width}px`,
        height: `${geometry().height}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={release}
      // A tap's compatibility mousedown would move focus off the input.
      onMouseDown={(event) => event.preventDefault()}
      data-docx-pages
    >
      {/* By position: every layout brings new page objects, and a page's
          canvas must survive them to be repainted strip by strip. */}
      <Index each={editor.pages()}>
        {(_, index) => (
          <Show when={geometry().boxes[index]}>
            {(box) => (
              <Page
                editor={editor}
                index={index}
                box={box()}
                root={props.scroller}
              />
            )}
          </Show>
        )}
      </Index>
      <div class="pointer-events-none absolute inset-0" data-docx-overlay>
        <StoryChrome
          editor={editor}
          geometry={geometry()}
          onClose={() => run([{ op: 'exitStory' }])}
        />
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
