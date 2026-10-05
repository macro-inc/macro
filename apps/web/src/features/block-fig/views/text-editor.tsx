/**
 * Typing into a text layer on the canvas, as in Figma.
 *
 * A hidden textarea takes the typing (so the browser handles input
 * methods, word moves and deletes, and the clipboard) and holds the
 * selection; the caret and selection are drawn over the canvas from the
 * engine's line geometry, so they follow the real font, mixed sizes, and
 * rotation. The engine lays the text out again after every change; typing
 * undoes in bursts. Clicks place the caret, double-clicks select a word,
 * triple-clicks a paragraph; ↑/↓ move by line, ⌘←/→ (Home/End) to a
 * line's ends, Shift extends, and ⌘B/⌘I/⌘U style the selection (or what is
 * typed next). Escape or a press elsewhere on the canvas ends editing; a
 * layer left empty is removed.
 */

import { IS_MAC } from '@core/constant/isMac';
import type { FigEngine } from '@core/fig-engine/client';
import type { NodeInfo, TextGeometry } from '@core/fig-engine/types';
import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  caretRect,
  hitIndex,
  lineEnds,
  paragraphAt,
  selectionRects,
  toLayer,
  verticalMove,
  wordAt,
} from '../core/caret';
import {
  rangeStyle,
  textFonts,
  toggleBold,
  toggleItalic,
  toggleUnderline,
} from '../core/rich-text';
import type { FigEditor, Patch } from '../primitives/create-fig-editor';
import type { FigViewer } from '../primitives/create-fig-viewer';
import type { FontRegistry } from '../primitives/create-font-registry';

let session = 0;

/** Typing after this long a pause starts a new undo step. */
const BURST_MS = 1000;

/** Where `after` differs from `before`: `[start, removedEnd, addedEnd]`. */
function changed(before: string, after: string): [number, number, number] {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  return [start, before.length - tail, after.length - tail];
}

export function TextEditor(props: {
  id: string;
  viewer: FigViewer;
  editor: FigEditor;
  engine: FigEngine;
  fonts?: FontRegistry;
  onDone: () => void;
}) {
  const key = `text-${++session}`;
  const [info, setInfo] = createSignal<NodeInfo>();
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
  /** Styles ⌘B/⌘I/⌘U set at a caret, for what is typed next. */
  let pendingStyle: Patch | undefined;
  /** The x a run of ↑/↓ moves keeps to. */
  let goalX: number | undefined;

  const load = async () => {
    try {
      const page = props.viewer.page();
      const [i, g] = await Promise.all([
        props.engine.nodeInfo(page, props.id),
        props.engine.textGeometry(page, props.id),
      ]);
      setInfo(i);
      setGeometry(g);
      // An undo or someone else's edit changed the text under the caret.
      const text = i.text?.characters ?? '';
      if (inflight === 0 && text !== latest && !i.text?.truncated) {
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
    props.editor.setTextSelection({ id: props.id, start, end });
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

  const fontsReady = async (text: string) => {
    const i = info()?.text;
    if (props.fonts && i) await props.fonts.ensureAll(textFonts(i), text);
  };

  onMount(async () => {
    const i = await load();
    if (!i) {
      props.onDone();
      return;
    }
    latest = i.text?.characters ?? '';
    area.value = latest;
    area.focus({ preventScroll: true });
    area.select();
    sync();
    await fontsReady(latest);
  });
  onCleanup(() => props.editor.setTextSelection(undefined));

  // Edits from the panel, undo, and other people change the layout.
  createEffect(
    on(props.viewer.editVersion, () => void load(), { defer: true })
  );

  let pending: Promise<unknown> = Promise.resolve();
  const send = (ops: Parameters<FigEditor['apply']>[0], coalesce?: string) => {
    inflight++;
    pending = pending.then(async () => {
      try {
        await fontsReady(latest);
        await props.editor.apply(ops, coalesce);
      } finally {
        inflight--;
      }
      await load();
    });
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
    const before = latest;
    latest = area.value;
    sync();
    goalX = undefined;
    const ops: Parameters<FigEditor['apply']>[0] = [
      { op: 'set', ids: [props.id], props: { characters: latest } },
    ];
    const [start, , added] = changed(before, latest);
    if (pendingStyle && added > start) {
      ops.push({
        op: 'set',
        ids: [props.id],
        props: { ...pendingStyle, textRange: [start, added] },
      });
    }
    if (added > start) pendingStyle = undefined;
    void send(ops, burstKey());
  };

  /** Styles the selection, or what is typed next at a caret. */
  const style = (patch: Patch) => {
    const { start, end } = sel();
    newBurst = true;
    if (start === end) {
      pendingStyle = { ...pendingStyle, ...patch };
      return;
    }
    void send([
      {
        op: 'set',
        ids: [props.id],
        props: { ...patch, textRange: [start, end] },
      },
    ]);
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
    // An emptied layer goes (layers in instances are only overridden).
    if (latest.trim() === '' && !props.id.startsWith('I'))
      await props.editor.apply([{ op: 'delete', ids: [props.id] }], key);
    props.onDone();
  };

  // A press elsewhere on the canvas ends editing; the panels keep it.
  const onDocumentDown = (e: PointerEvent) => {
    const target = e.target as Element | null;
    if (!target || root.contains(target)) return;
    if (target.closest('[data-testid="fig-canvas"]')) void finish();
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

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    const mod = IS_MAC ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      void finish();
      return;
    }
    if (mod && !e.altKey && (k === 'b' || k === 'i' || k === 'u')) {
      e.preventDefault();
      const text = info()?.text;
      if (!text) return;
      const { start, end } = sel();
      const r = rangeStyle(text, start, end);
      style(
        k === 'b'
          ? toggleBold(r)
          : k === 'i'
            ? toggleItalic(r)
            : toggleUnderline(r)
      );
      return;
    }
    if (mod && (k === 'z' || k === 'y')) {
      e.preventDefault();
      void history(k === 'y' || e.shiftKey);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      // Figma's soft line break.
      e.preventDefault();
      area.setRangeText(' ', area.selectionStart, area.selectionEnd, 'end');
      onInput();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end');
      onInput();
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
      const { key, shiftKey } = e;
      // After what was typed is laid out.
      void pending.then(() => moveByLine(key, shiftKey, vertical));
      return;
    }
    goalX = undefined;
    if (e.key.startsWith('Arrow')) newBurst = true;
    // Native handling (word moves, deletes) moves the selection after this.
    setTimeout(sync, 0);
  };

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

  // ---- pointer -------------------------------------------------------------

  const pagePoint = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    const c = props.viewer.camera();
    return {
      x: c.x + (e.clientX - r.left) / c.zoom,
      y: c.y + (e.clientY - r.top) / c.zoom,
    };
  };
  const indexAt = (e: PointerEvent) => {
    const g = geometry();
    if (!g) return 0;
    const p = pagePoint(e);
    const local = toLayer(g.transform, p.x, p.y);
    return hitIndex(g, local.x, local.y);
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
    const at = indexAt(e);
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
    const at = indexAt(e);
    const [a, b] = dragAnchor;
    if (at < a) select(b, at);
    else select(a, Math.max(at, b));
  };
  const onBoxUp = () => {
    dragAnchor = undefined;
  };

  // ---- drawing -------------------------------------------------------------

  /** Layer to screen, as a CSS matrix. */
  const matrix = () => {
    const g = geometry();
    if (!g) return undefined;
    const c = props.viewer.camera();
    const [a, b, cc, d, e, f] = g.transform;
    const z = c.zoom;
    return `matrix(${a * z}, ${b * z}, ${cc * z}, ${d * z}, ${(e - c.x) * z}, ${(f - c.y) * z})`;
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
    return {
      left: `${(x - c.x) * c.zoom}px`,
      top: `${(y - c.y) * c.zoom}px`,
    };
  };
  const hairline = () => `${1 / props.viewer.camera().zoom}px`;

  return (
    <div
      ref={root}
      class="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-testid="fig-text-editing"
    >
      <Show when={info() && matrix()}>
        {(m) => (
          <div
            class="absolute top-0 left-0"
            style={{ transform: m(), 'transform-origin': '0 0' }}
          >
            <div
              class="pointer-events-auto absolute top-0 left-0 cursor-text outline outline-accent"
              data-testid="fig-text-box"
              style={{
                width: `${info()?.width ?? 0}px`,
                height: `${info()?.height ?? 0}px`,
                'outline-width': hairline(),
              }}
              onPointerDown={onBoxDown}
              onPointerMove={onBoxMove}
              onPointerUp={onBoxUp}
              onPointerCancel={onBoxUp}
              onDblClick={(e) => e.stopPropagation()}
            />
            <For each={rects()}>
              {(r) => (
                <div
                  class="absolute bg-accent/30"
                  data-testid="fig-text-selection"
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
                  data-testid="fig-text-caret"
                  style={{
                    opacity: blink() ? 1 : 0,
                    left: `${c().x}px`,
                    top: `${c().top}px`,
                    width: `${1.5 / props.viewer.camera().zoom}px`,
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
        data-testid="fig-text-editor"
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
