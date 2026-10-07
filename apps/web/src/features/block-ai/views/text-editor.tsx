/**
 * Typing into a text object on the canvas, as Illustrator's type tool does.
 *
 * A hidden textarea takes the typing (so the browser handles input
 * methods, word moves and deletes, and the clipboard) and holds the
 * selection; the caret and selection are drawn over the canvas from the
 * engine's line geometry, so they follow the font, alignment, wrapping,
 * and the object's transform. The engine lays the text out again after
 * every change; typing undoes in bursts. A click places the caret, a
 * double-click selects a word, a triple-click a paragraph; ↑/↓ move by
 * line, ⌘←/→ (Home/End) to a line's ends, and Shift extends. Escape or a
 * press elsewhere on the canvas ends editing; a text left empty is
 * removed. The family loads before the text is first laid out.
 */

import {
  caretRect,
  hitIndex,
  lineEnds,
  paragraphAt,
  selectionRects,
  toLayer,
  verticalMove,
  wordAt,
} from '@app/features/block-fig/core/caret';
import type { Info, TextGeometry } from '@core/ai-engine/types';
import { IS_MAC } from '@core/constant/isMac';
import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { Point } from '../core/geometry';
import type { AiEditor } from '../primitives/create-ai-editor';
import type { AiViewer } from '../primitives/create-ai-viewer';
import type { FontLoader } from '../primitives/create-font-loader';

let session = 0;

/** Typing after this long a pause starts a new undo step. */
const BURST_MS = 1000;

export function TextEditor(props: {
  id: number;
  /** Where the caret goes (canvas); the end of the text when absent. */
  at?: Point;
  viewer: AiViewer;
  editor: AiEditor;
  fonts?: FontLoader;
  onDone: () => void;
}) {
  const engine = props.viewer.engine;
  const key = `text-${++session}`;
  const [info, setInfo] = createSignal<Info>();
  const [geometry, setGeometry] = createSignal<TextGeometry | null>(null);
  const [sel, setSel] = createSignal({ start: 0, end: 0, focus: 0 });
  // The caret blinks, and shows steadily right after it moves.
  const [blink, setBlink] = createSignal(true);
  const blinker = setInterval(() => setBlink((b) => !b), 530);
  onCleanup(() => clearInterval(blinker));
  let area!: HTMLTextAreaElement;
  let root!: HTMLDivElement;
  let done = false;
  let latest = '';
  /** Changes sent but not yet laid out. */
  let inflight = 0;
  let burst = 0;
  let lastInput = 0;
  let newBurst = true;
  /** The x a run of ↑/↓ moves keeps to. */
  let goalX: number | undefined;
  let fontsReady: Promise<unknown> = Promise.resolve();

  const load = async () => {
    try {
      const [i, g] = await Promise.all([
        engine.info(props.id),
        engine.textGeometry(props.id),
      ]);
      if (!i?.text) return undefined;
      setInfo(i);
      setGeometry(g);
      // An undo or someone else's edit changed the text under the caret.
      const text = i.text.text;
      if (inflight === 0 && text !== latest) {
        latest = text;
        area.value = text;
        const at = Math.min(sel().focus, text.length);
        area.setSelectionRange(at, at);
        sync();
      }
      return i;
    } catch {
      return undefined;
    }
  };

  /** Mirrors the textarea's selection. */
  const sync = () => {
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const focus = area.selectionDirection === 'backward' ? start : end;
    const s = sel();
    if (s.start === start && s.end === end && s.focus === focus) return;
    setSel({ start, end, focus });
    setBlink(true);
  };

  /** Selects `anchor..focus` (the focus is where the caret shows). */
  const select = (anchor: number, focus: number) => {
    area.setSelectionRange(
      Math.min(anchor, focus),
      Math.max(anchor, focus),
      focus < anchor ? 'backward' : 'forward'
    );
    newBurst = true;
    sync();
  };
  const anchor = () => (sel().focus === sel().start ? sel().end : sel().start);

  /** The character nearest a canvas point. */
  const indexAtCanvas = (p: Point) => {
    const g = geometry();
    if (!g) return 0;
    const local = toLayer(g.transform, p.x, p.y);
    return hitIndex(g, local.x, local.y);
  };

  onMount(async () => {
    props.editor.setEditingText(props.id);
    const i = await load();
    if (!i?.text) {
      props.onDone();
      return;
    }
    latest = i.text.text;
    area.value = latest;
    area.focus({ preventScroll: true });
    const at = props.at ? indexAtCanvas(props.at) : latest.length;
    area.setSelectionRange(at, at);
    sync();
    if (props.fonts)
      fontsReady = props.fonts.ensure(i.text.family, i.text.style, latest);
  });
  onCleanup(() => props.editor.setEditingText(undefined));

  // Panel edits, undo, and other people change the layout.
  createEffect(
    on(props.viewer.editVersion, () => void load(), { defer: true })
  );

  let pending: Promise<unknown> = Promise.resolve();
  const send = (text: string, coalesce: string) => {
    inflight++;
    const after = async (before: Promise<unknown>) => {
      await before;
      try {
        await fontsReady;
        await props.editor.apply(
          [{ op: 'setText', id: props.id, text }],
          coalesce
        );
      } finally {
        inflight--;
      }
      await load();
    };
    pending = after(pending);
    return pending;
  };

  const burstKey = () => {
    const now = performance.now();
    if (newBurst || now - lastInput > BURST_MS) burst++;
    newBurst = false;
    lastInput = now;
    return `${key}-${burst}`;
  };

  const onInput = () => {
    latest = area.value;
    sync();
    goalX = undefined;
    void send(latest, burstKey());
  };

  const history = async (redo: boolean) => {
    await pending;
    newBurst = true;
    await (redo ? props.editor.redo() : props.editor.undo());
    await load();
  };

  const finish = async () => {
    if (done) return;
    done = true;
    await pending;
    // A text left empty goes, as in Illustrator.
    if (latest.trim() === '') {
      props.viewer.select([]);
      await props.editor.apply([{ op: 'delete', ids: [props.id] }], key);
    }
    props.onDone();
  };

  // A press elsewhere on the canvas ends editing; the panels keep it.
  const onDocumentDown = (e: PointerEvent) => {
    const target = e.target as Element | null;
    if (!target || root.contains(target)) return;
    if (target.closest('[data-testid="ai-canvas"]')) void finish();
  };
  document.addEventListener('pointerdown', onDocumentDown, true);
  const onSelectionChange = () => {
    if (document.activeElement === area) sync();
  };
  document.addEventListener('selectionchange', onSelectionChange);
  onCleanup(() => {
    document.removeEventListener('pointerdown', onDocumentDown, true);
    document.removeEventListener('selectionchange', onSelectionChange);
  });

  /** ↑/↓ by line (keeping the x), or to a line's start or end. */
  const moveByLine = (key: string, extend: boolean, vertical: boolean) => {
    const g = geometry();
    if (!g) return;
    const focus = sel().focus;
    let to: number;
    if (vertical) {
      const x = goalX ?? caretRect(g, focus)?.x ?? 0;
      goalX = x;
      to = verticalMove(g, focus, key === 'ArrowUp' ? -1 : 1, x);
    } else {
      goalX = undefined;
      const [a, b] = lineEnds(g, focus);
      to = key === 'Home' || key === 'ArrowLeft' ? a : b;
    }
    select(extend ? anchor() : to, to);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      void finish();
      return;
    }
    if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      void history(e.key.toLowerCase() === 'y' || e.shiftKey);
      return;
    }
    const vertical =
      (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !(IS_MAC && e.metaKey);
    const lineKey =
      e.key === 'Home' ||
      e.key === 'End' ||
      (IS_MAC &&
        e.metaKey &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight'));
    if (vertical || lineKey) {
      e.preventDefault();
      const { key: pressed, shiftKey } = e;
      // After what was typed is laid out.
      void (async () => {
        await pending;
        moveByLine(pressed, shiftKey, vertical);
      })();
      return;
    }
    goalX = undefined;
    if (e.key.startsWith('Arrow')) newBurst = true;
    // Native handling (word moves, deletes) moves the selection after this.
    setTimeout(sync, 0);
  };

  // ---- pointer -------------------------------------------------------------

  const canvasPoint = (e: PointerEvent): Point => {
    const r = root.getBoundingClientRect();
    const c = props.viewer.camera();
    return {
      x: c.x + (e.clientX - r.left) / c.zoom,
      y: c.y + (e.clientY - r.top) / c.zoom,
    };
  };
  let dragAnchor: [number, number] | undefined;
  // Pointer events carry no click count: presses close in time and place
  // count up (double: a word, triple: a paragraph).
  let lastPress = { time: 0, x: 0, y: 0, count: 0 };
  const clickCount = (e: PointerEvent) => {
    const near =
      e.timeStamp - lastPress.time < 500 &&
      Math.hypot(e.clientX - lastPress.x, e.clientY - lastPress.y) < 5;
    const count = near ? lastPress.count + 1 : 1;
    lastPress = { time: e.timeStamp, x: e.clientX, y: e.clientY, count };
    return count;
  };
  const onBoxDown = (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    area.focus({ preventScroll: true });
    const at = indexAtCanvas(canvasPoint(e));
    const clicks = clickCount(e);
    goalX = undefined;
    let range: [number, number] = [at, at];
    if (clicks === 2) range = wordAt(latest, at);
    else if (clicks >= 3) range = paragraphAt(latest, at);
    if (e.shiftKey && clicks === 1) {
      select(anchor(), at);
      dragAnchor = [anchor(), anchor()];
    } else {
      select(range[0], range[1]);
      dragAnchor = range;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onBoxMove = (e: PointerEvent) => {
    if (!dragAnchor) return;
    const at = indexAtCanvas(canvasPoint(e));
    const [a, b] = dragAnchor;
    if (at < a) select(b, at);
    else select(a, Math.max(at, b));
  };
  const onBoxUp = () => {
    dragAnchor = undefined;
  };

  // ---- drawing -------------------------------------------------------------

  /** Text space to screen, as a CSS matrix. */
  const matrix = () => {
    const g = geometry();
    if (!g) return undefined;
    const c = props.viewer.camera();
    const [a, b, cc, d, e, f] = g.transform;
    const z = c.zoom;
    return `matrix(${a * z}, ${b * z}, ${cc * z}, ${d * z}, ${(e - c.x) * z}, ${(f - c.y) * z})`;
  };

  /** The text's box in its own space: its lines, or the area's width. */
  const box = () => {
    const g = geometry();
    if (!g || g.lines.length === 0) return undefined;
    const xs = g.lines.flatMap((l) => l.xs);
    const width = info()?.text?.width;
    const x0 = width ? 0 : Math.min(...xs);
    const x1 = width ? width : Math.max(...xs);
    const first = g.lines[0];
    const last = g.lines[g.lines.length - 1];
    const pad = first.height * 0.1;
    return {
      x: x0 - pad,
      y: first.top,
      w: Math.max(x1 - x0, first.height * 0.5) + 2 * pad,
      h: last.top + last.height - first.top,
    };
  };

  const caret = () => {
    const g = geometry();
    const s = sel();
    return g && s.start === s.end ? caretRect(g, s.focus) : null;
  };
  const rects = () => {
    const g = geometry();
    const s = sel();
    return g ? selectionRects(g, s.start, s.end) : [];
  };
  /** Where the textarea sits (screen), so input method popups open there. */
  const imeAt = () => {
    const g = geometry();
    const at = g ? caretRect(g, sel().focus) : null;
    if (!g || !at) return { left: '0px', top: '0px' };
    const [a, b, cc, d, e, f] = g.transform;
    const c = props.viewer.camera();
    const x = a * at.x + cc * (at.top + at.height) + e;
    const y = b * at.x + d * (at.top + at.height) + f;
    return { left: `${(x - c.x) * c.zoom}px`, top: `${(y - c.y) * c.zoom}px` };
  };
  /** One screen pixel in text space. */
  const hairline = () => {
    const g = geometry();
    const scale = g
      ? Math.sqrt(
          Math.abs(
            g.transform[0] * g.transform[3] - g.transform[1] * g.transform[2]
          )
        )
      : 1;
    return 1 / (props.viewer.camera().zoom * (scale || 1));
  };

  return (
    <div
      ref={root}
      class="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-testid="ai-text-editing"
    >
      <Show when={matrix()}>
        {(m) => (
          <div
            class="absolute top-0 left-0"
            style={{ transform: m(), 'transform-origin': '0 0' }}
          >
            <Show when={box()}>
              {(b) => (
                <div
                  class="pointer-events-auto absolute cursor-text outline outline-accent"
                  data-testid="ai-text-box"
                  style={{
                    left: `${b().x}px`,
                    top: `${b().y}px`,
                    width: `${b().w}px`,
                    height: `${b().h}px`,
                    'outline-width': `${hairline()}px`,
                  }}
                  onPointerDown={onBoxDown}
                  onPointerMove={onBoxMove}
                  onPointerUp={onBoxUp}
                  onPointerCancel={onBoxUp}
                  onDblClick={(e) => e.stopPropagation()}
                />
              )}
            </Show>
            <For each={rects()}>
              {(r) => (
                <div
                  class="absolute bg-accent/30"
                  data-testid="ai-text-selection"
                  style={{
                    left: `${r.x}px`,
                    top: `${r.y}px`,
                    width: `${r.w}px`,
                    height: `${r.h}px`,
                  }}
                />
              )}
            </For>
            <Show when={caret()}>
              {(c) => (
                <div
                  class="absolute bg-accent"
                  data-testid="ai-text-caret"
                  style={{
                    opacity: blink() ? 1 : 0,
                    left: `${c().x}px`,
                    top: `${c().top}px`,
                    width: `${1.5 * hairline()}px`,
                    height: `${c().height}px`,
                  }}
                />
              )}
            </Show>
          </div>
        )}
      </Show>
      <textarea
        ref={area}
        data-testid="ai-text-input"
        aria-label="Text"
        spellcheck={false}
        autocomplete="off"
        class="absolute m-0 size-px resize-none overflow-hidden border-0 p-0 opacity-0"
        style={imeAt()}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onKeyUp={sync}
        onSelect={sync}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
