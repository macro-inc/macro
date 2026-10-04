/**
 * Typing into a text layer on the canvas.
 *
 * A transparent textarea sits exactly over the layer, in the same font,
 * size, and line height, so the browser draws the caret and selection while
 * the engine re-lays out and renders the text underneath on every keystroke
 * (one undo step per editing session). Escape or a press elsewhere ends
 * editing; a layer left empty is removed, as in Figma.
 */

import type { FigEngine } from '@core/fig-engine/client';
import type { NodeInfo } from '@core/fig-engine/types';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { cssLineHeight, parseStyle } from '../core/type';
import type { FigEditor } from '../primitives/create-fig-editor';
import type { FigViewer } from '../primitives/create-fig-viewer';

let session = 0;

function textAlign(
  a: string | null | undefined
): 'left' | 'center' | 'right' | 'justify' {
  if (a === 'CENTER') return 'center';
  if (a === 'RIGHT') return 'right';
  if (a === 'JUSTIFIED') return 'justify';
  return 'left';
}

export function TextEditor(props: {
  id: string;
  viewer: FigViewer;
  editor: FigEditor;
  engine: FigEngine;
  onDone: () => void;
}) {
  const key = `text-${++session}`;
  const [info, setInfo] = createSignal<NodeInfo>();
  let area!: HTMLTextAreaElement;
  let done = false;
  let latest = '';

  const load = async () => {
    try {
      const i = await props.engine.nodeInfo(props.viewer.page(), props.id);
      setInfo(i);
      return i;
    } catch {
      return undefined;
    }
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
  });

  let pending: Promise<unknown> = Promise.resolve();
  const onInput = () => {
    latest = area.value;
    const characters = latest;
    pending = pending.then(async () => {
      if (characters !== latest) return;
      await props.editor.apply(
        [{ op: 'set', ids: [props.id], props: { characters } }],
        key
      );
      await load();
    });
  };

  const finish = async () => {
    if (done) return;
    done = true;
    await pending;
    if (latest.trim() === '')
      await props.editor.apply([{ op: 'delete', ids: [props.id] }], key);
    props.onDone();
  };

  // A press anywhere outside ends editing.
  const onDocumentDown = (e: PointerEvent) => {
    if (e.target !== area) void finish();
  };
  document.addEventListener('pointerdown', onDocumentDown, true);
  onCleanup(() =>
    document.removeEventListener('pointerdown', onDocumentDown, true)
  );

  const box = (): JSX.CSSProperties | undefined => {
    const i = info();
    if (!i) return undefined;
    const c = props.viewer.camera();
    const t = i.text;
    const size = (t?.fontSize ?? 12) * c.zoom;
    const lineHeight = cssLineHeight(t?.lineHeight ?? null, c.zoom);
    const ls = t?.letterSpacing;
    const letterSpacing = ls
      ? ls[1] === 'PERCENT'
        ? `${ls[0] / 100}em`
        : `${ls[0] * c.zoom}px`
      : 'normal';
    const { weight, italic } = parseStyle(t?.fontStyle);
    const autoWidth = t?.autoResize === 'WIDTH_AND_HEIGHT';
    return {
      left: `${(i.bounds.x - c.x) * c.zoom}px`,
      top: `${(i.bounds.y - c.y) * c.zoom}px`,
      // Room to grow while the engine catches up with auto-width text.
      width: `${Math.max(i.bounds.w * c.zoom, 4) + (autoWidth ? size * 4 : 0)}px`,
      height: `${Math.max(i.bounds.h * c.zoom, size * 1.3) + size * 1.3}px`,
      'font-family': `"${t?.fontFamily ?? 'Inter'}", "Inter Variable", Inter, sans-serif`,
      'font-size': `${size}px`,
      'font-weight': String(weight),
      'font-style': italic ? 'italic' : 'normal',
      'letter-spacing': letterSpacing,
      'text-transform':
        t?.case === 'UPPER'
          ? 'uppercase'
          : t?.case === 'LOWER'
            ? 'lowercase'
            : t?.case === 'TITLE'
              ? 'capitalize'
              : 'none',
      'line-height': lineHeight,
      'text-align': textAlign(t?.alignHorizontal),
      'white-space': autoWidth ? 'pre' : 'pre-wrap',
    };
  };

  return (
    <Show when={box()}>
      {(style) => (
        <textarea
          ref={area}
          data-testid="fig-text-editor"
          aria-label="Text"
          spellcheck={false}
          class="absolute z-20 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-accent outline outline-1 outline-accent selection:bg-accent/30"
          style={style()}
          onInput={onInput}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              void finish();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      )}
    </Show>
  );
}
