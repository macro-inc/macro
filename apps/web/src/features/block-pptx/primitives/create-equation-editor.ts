/**
 * The equation being written or edited (Insert ▸ Equation, the Equation tab):
 * its linear text, a live preview rendered by the engine, and the edits that
 * put it on the slide. A new equation goes in when committed. An equation
 * selected on the slide is edited through the same text, every valid change
 * landing on the slide as it is typed (one undo step per equation).
 */

import type { EditOp, EditResult } from '@core/pptx-engine/types';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  type EquationRef,
  type InsertionPoint,
  insertTemplate,
  type SelectedEquation,
} from '../core/equations';

export type EquationTarget =
  | { kind: 'new'; where: InsertionPoint }
  | ({ kind: 'edit' } & EquationRef);

/** A rendered picture of linear text; sizes in points (CSS pixels). */
export interface EquationPicture {
  url: string;
  width: number;
  height: number;
}

export interface EquationEditorOptions {
  engine: Pick<PresentationEngine, 'renderEquation'>;
  apply: (ops: EditOp[], group?: string) => Promise<EditResult | null>;
  /** The equation the text selection covers (selected as a whole). */
  selected: Accessor<SelectedEquation | undefined>;
  /** After a new equation went in (`result` reports a new text box). */
  onInserted: (
    where: InsertionPoint,
    result: EditResult | null
  ) => void | Promise<void>;
  /** Gives focus back to what was edited before the editor took it. */
  onClose: () => void;
}

/** Quiet period before typed text is rendered and reaches the slide. */
const LIVE_DELAY = 200;

const PREVIEW_SIZE = 24;
const THUMBNAIL_SIZE = 16;

const refKey = (t: EquationRef) =>
  `${t.slide}:${t.shape}:${t.cell ? `${t.cell.row},${t.cell.col}` : ''}:${t.paragraph}:${t.index}`;

/** Pixel width and height from a PNG's header. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return bytes.byteLength >= 24
    ? { width: view.getUint32(16), height: view.getUint32(20) }
    : { width: 0, height: 0 };
}

export function createEquationEditor(options: EquationEditorOptions) {
  /** A new equation being written. */
  const [fresh, setFresh] = createSignal<{
    where: InsertionPoint;
    text: string;
    display: boolean;
  }>();
  /** Text typed for the selected equation, until another one is selected. */
  const [draft, setDraft] = createSignal<{
    key: string;
    text: string;
    display: boolean;
  }>();
  /** The selected equation whose editor was closed. */
  const [dismissed, setDismissed] = createSignal<string>();
  const [error, setError] = createSignal<string>();
  const [preview, setPreview] = createSignal<EquationPicture>();
  /** Ink color of previews (`RRGGBB`), to read on the panel's surface. */
  const [ink, setInkRaw] = createSignal('000000');
  let input: HTMLTextAreaElement | undefined;
  /** The linear text's selection when it lost focus (to a gallery). */
  let lastSelection: [number, number] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** What was last put on the slide per equation (`text|display`). */
  const pushed = new Map<string, string>();
  let renderToken = 0;
  const thumbnails = new Map<string, Promise<EquationPicture | undefined>>();

  /** Pixels per point: at least 2, so thin strokes stay crisp when small. */
  const scale = () =>
    typeof window === 'undefined'
      ? 2
      : Math.min(3, Math.max(2, window.devicePixelRatio || 1));

  const selectedKey = createMemo(() => {
    const s = options.selected();
    return s ? refKey(s) : undefined;
  });

  const target = (): EquationTarget | undefined => {
    const f = fresh();
    if (f) return { kind: 'new', where: f.where };
    const s = options.selected();
    if (!s || selectedKey() === dismissed()) return undefined;
    const { latex: _l, display: _d, ...ref } = s;
    return { kind: 'edit', ...ref };
  };

  /** The draft of the selected equation, if one was typed. */
  const currentDraft = () => {
    const d = draft();
    return d && d.key === selectedKey() ? d : undefined;
  };

  const latex = (): string =>
    fresh()?.text ?? currentDraft()?.text ?? options.selected()?.latex ?? '';
  const display = (): boolean =>
    fresh()?.display ??
    currentDraft()?.display ??
    options.selected()?.display ??
    true;

  async function render(
    text: string,
    size: number,
    asDisplay: boolean
  ): Promise<EquationPicture> {
    const draw = options.engine.renderEquation;
    if (!draw) throw new Error('Equations cannot be shown here');
    const s = scale();
    const bytes = await draw(text, {
      display: asDisplay,
      size,
      scale: s,
      color: ink(),
    });
    const { width, height } = pngSize(bytes);
    return {
      url: URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      ),
      width: width / s,
      height: height / s,
    };
  }

  function replacePreview(next: EquationPicture | undefined) {
    const old = preview();
    if (old) URL.revokeObjectURL(old.url);
    setPreview(next);
  }

  /** Renders the preview; resolves whether the text is valid. */
  async function refreshPreview(
    text: string,
    asDisplay: boolean
  ): Promise<boolean> {
    const token = ++renderToken;
    if (!text.trim()) {
      replacePreview(undefined);
      setError(undefined);
      return false;
    }
    try {
      const picture = await render(text, PREVIEW_SIZE, asDisplay);
      if (token !== renderToken) {
        // A later render shows instead; the text was still valid.
        URL.revokeObjectURL(picture.url);
        return true;
      }
      replacePreview(picture);
      setError(undefined);
      return true;
    } catch (e) {
      if (token === renderToken)
        setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** Renders the current text and puts a typed change on the slide. */
  async function sync() {
    const text = latex();
    const asDisplay = display();
    const valid = await refreshPreview(text, asDisplay);
    const s = options.selected();
    const d = currentDraft();
    // Text typed meanwhile is synced by the call it scheduled.
    if (!valid || fresh() || !s || !d || d.text !== text) return;
    const key = refKey(s);
    const state = `${d.text}|${d.display}`;
    if ((pushed.get(key) ?? `${s.latex}|${s.display}`) === state) return;
    pushed.set(key, state);
    await options.apply(
      [
        {
          op: 'setEquation',
          slide: s.slide,
          shape: s.shape,
          ...(s.cell ? { cell: s.cell } : {}),
          paragraph: s.paragraph,
          index: s.index,
          latex: d.text,
          display: d.display,
        },
      ],
      `equation:${key}`
    );
  }

  /** Renders (and applies) once typing pauses. */
  function schedule(delay = LIVE_DELAY) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void sync();
    }, delay);
  }

  /** Runs a change still waiting for its quiet period. */
  async function flush() {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
    await sync();
  }

  // The preview follows what is shown: rendering it is the worker's job.
  const shown = createMemo(() => {
    const t = target();
    return t ? `${t.kind}|${selectedKey() ?? ''}|${display()}|${latex()}` : '';
  });
  createEffect(
    on(
      shown,
      (now, before) => {
        if (!now) {
          if (timer) clearTimeout(timer);
          timer = undefined;
          renderToken++;
          replacePreview(undefined);
          setError(undefined);
          return;
        }
        // A newly shown equation renders at once; typing waits for a pause.
        const sameTarget =
          before &&
          now.split('|', 2).join('|') === before.split('|', 2).join('|');
        if (!sameTarget) lastSelection = undefined;
        schedule(sameTarget ? LIVE_DELAY : 0);
      },
      { defer: false }
    )
  );

  function setLatex(text: string) {
    const f = fresh();
    if (f) {
      setFresh({ ...f, text });
      return;
    }
    const key = selectedKey();
    if (key) setDraft({ key, text, display: display() });
  }

  function setDisplay(on: boolean) {
    const f = fresh();
    if (f) {
      setFresh({ ...f, display: on });
      return;
    }
    const key = selectedKey();
    if (key) setDraft({ key, text: latex(), display: on });
  }

  /** Starts a new equation (empty, or from linear text). */
  function openNew(
    where: InsertionPoint,
    text = '',
    asDisplay = where.kind === 'box'
  ) {
    void flush();
    setFresh({ where, text, display: asDisplay });
    queueMicrotask(() => focusInput(text.length));
  }

  /** Shows the selected equation's text again after it was closed. */
  function reveal(focus = false) {
    setDismissed(undefined);
    if (focus) queueMicrotask(() => focusInput(latex().length));
  }

  /** Inserts the new equation, or finishes editing the selected one. */
  async function commit() {
    const t = target();
    if (!t) return;
    if (t.kind === 'edit') {
      await flush();
      close();
      return;
    }
    const f = fresh();
    if (!f) return;
    if (!(await refreshPreview(f.text, f.display))) return;
    const where = f.where;
    const ops: EditOp[] =
      where.kind === 'box'
        ? [
            {
              op: 'insertEquation',
              slide: where.slide,
              latex: f.text,
              display: f.display,
            },
          ]
        : [
            ...(where.end
              ? [
                  {
                    op: 'deleteText' as const,
                    slide: where.slide,
                    shape: where.shape,
                    ...(where.cell ? { cell: where.cell } : {}),
                    start: where.at,
                    end: where.end,
                  },
                ]
              : []),
            {
              op: 'insertEquation',
              slide: where.slide,
              shape: where.shape,
              ...(where.cell ? { cell: where.cell } : {}),
              at: where.at,
              latex: f.text,
              display: f.display,
            },
          ];
    const result = await options.apply(ops);
    setFresh(undefined);
    setDismissed(undefined);
    await options.onInserted(where, result);
    queueMicrotask(() => focusInput(latex().length));
  }

  /** Closes the editor; the equation stays selected. */
  function close() {
    void flush();
    if (fresh()) setFresh(undefined);
    else setDismissed(selectedKey());
    options.onClose();
  }

  function registerInput(el: HTMLTextAreaElement) {
    input = el;
    el.addEventListener('blur', () => {
      lastSelection = [el.selectionStart, el.selectionEnd];
    });
  }

  function focusInput(caret: number) {
    if (!input?.isConnected) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(caret, caret);
  }

  /** Inserts a structure or symbol at the caret of the linear text. */
  function insert(template: string) {
    if (!target()) reveal();
    const text = latex();
    // The caret of the text, or where it was before a gallery took focus.
    const [start, end] =
      input && document.activeElement === input
        ? [input.selectionStart, input.selectionEnd]
        : (lastSelection ?? [text.length, text.length]).map((i) =>
            Math.min(i, text.length)
          );
    const next = insertTemplate(text, start, end, template);
    setLatex(next.text);
    queueMicrotask(() => focusInput(next.caret));
  }

  /** Sets the preview ink (`RRGGBB`) to read on the surface around it. */
  function setInk(hex: string) {
    if (hex === ink()) return;
    setInkRaw(hex);
    if (target()) schedule(0);
  }

  /** A gallery picture of linear text (cached), or `undefined`. */
  function thumbnail(text: string): Promise<EquationPicture | undefined> {
    const key = `${ink()}|${text}`;
    let found = thumbnails.get(key);
    if (!found) {
      found = render(text, THUMBNAIL_SIZE, false).catch(() => undefined);
      thumbnails.set(key, found);
    }
    return found;
  }

  onCleanup(() => {
    if (timer) clearTimeout(timer);
    const picture = preview();
    if (picture) URL.revokeObjectURL(picture.url);
    for (const p of thumbnails.values())
      void p.then((picture) => picture && URL.revokeObjectURL(picture.url));
  });

  return {
    target,
    latex,
    display,
    error,
    preview,
    setLatex,
    setDisplay,
    openNew,
    reveal,
    commit,
    close,
    flush,
    insert,
    registerInput,
    setInk,
    thumbnail,
  };
}

export type EquationEditor = ReturnType<typeof createEquationEditor>;
