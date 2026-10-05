/**
 * SmartArt on the slide stage: "[Text]" prompts in empty nodes, the picked
 * node's outline, typing into a node in place, and the Text Pane with the
 * tab on the graphic's edge that opens it.
 */

import type {
  ShapeOutline,
  SmartArtNodeOutline,
} from '@core/pptx-engine/types';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { nodeBox, PROMPT } from '../../core/smartart';
import type { SmartArtState } from '../../primitives/create-smart-art';
import { SmartArtTextPane } from './text-pane';

/** How long typing pauses before the text reaches the graphic. */
const TYPING_DELAY = 150;
/** The Text Pane's width in CSS pixels (see `SmartArtTextPane`). */
const PANE_WIDTH = 240;

const px = (n: number) => `${n}px`;

/** "[Text]" in a node with no text (not printed or shown in the slide show). */
function Prompt(props: {
  shape: ShapeOutline;
  node: SmartArtNodeOutline;
  scale: number;
}) {
  const box = () => nodeBox(props.shape, props.node);
  return (
    <Show when={box()}>
      {(b) => (
        <div
          aria-hidden="true"
          data-testid="pptx-smartart-prompt"
          class="pointer-events-none absolute flex items-center justify-center overflow-hidden text-center leading-none"
          style={{
            left: px(b().x * props.scale),
            top: px(b().y * props.scale),
            width: px(b().w * props.scale),
            height: px(b().h * props.scale),
            'font-size': px((props.node.fontSize ?? 18) * props.scale),
            color: props.node.textColor ?? 'currentColor',
          }}
        >
          {PROMPT}
        </div>
      )}
    </Show>
  );
}

/** A node's text typed in place, over its shape. */
function NodeEditor(props: {
  smartArt: SmartArtState;
  shape: ShapeOutline;
  node: SmartArtNodeOutline;
  scale: number;
  onDone: () => void;
}) {
  const s = () => props.smartArt;
  const box = () =>
    nodeBox(props.shape, props.node) ?? {
      x: props.shape.x,
      y: props.shape.y,
      w: props.shape.w,
      h: props.shape.h,
    };
  const seed = s().editSeed();
  const [value, setValue] = createSignal(seed ?? props.node.text);
  // Text goes to this graphic even if it is deselected first.
  const at = s().target();
  const node = props.node.id;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sent = props.node.text;
  const commit = () => {
    clearTimeout(timer);
    const text = value();
    if (text === sent) return;
    sent = text;
    void s().setText(node, text, at);
  };
  onCleanup(commit);
  if (seed !== undefined) queueMicrotask(commit);
  const done = () => {
    commit();
    s().stopEditing();
    props.onDone();
  };
  const size = () =>
    Math.max(10, Math.min(48, (props.node.fontSize ?? 18) * props.scale));
  return (
    <textarea
      data-testid="pptx-smartart-node-input"
      aria-label="SmartArt shape text"
      class="absolute z-10 resize-none overflow-hidden rounded-sm border-2 border-accent bg-surface/90 p-1 text-center text-ink shadow-lg outline-none"
      style={{
        left: px(box().x * props.scale),
        top: px(box().y * props.scale),
        width: px(Math.max(80, box().w * props.scale)),
        height: px(Math.max(32, box().h * props.scale)),
        'font-size': px(size()),
        'line-height': '1.1',
      }}
      value={value()}
      placeholder={PROMPT}
      spellcheck={false}
      ref={(el) =>
        queueMicrotask(() => {
          el.focus({ preventScroll: true });
          el.setSelectionRange(el.value.length, el.value.length);
        })
      }
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onInput={(e) => {
        setValue(e.currentTarget.value);
        clearTimeout(timer);
        timer = setTimeout(commit, TYPING_DELAY);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          done();
        }
      }}
      onBlur={() => {
        commit();
        s().stopEditing();
      }}
    />
  );
}

export function SmartArtStage(props: {
  smartArt: SmartArtState;
  /** The current slide's shapes (prompts show in every SmartArt graphic). */
  shapes: ShapeOutline[];
  /** CSS pixels per point. */
  scale: number;
  /** The slide's size in points. */
  slideWidth: number;
  /** Visible room left and right of the slide, in CSS pixels. */
  room?: () => { left: number; right: number };
  readonly: boolean;
  /** Puts focus back on the slide. */
  onDone: () => void;
}) {
  const s = () => props.smartArt;
  const graphics = () =>
    props.shapes.filter((shape) => shape.smartArt && !shape.rotation);
  const frame = () => s().frame();
  const active = () => {
    const f = frame();
    const id = s().activeNode();
    const node = id && f?.smartArt?.nodes.find((n) => n.id === id);
    return f && node ? { shape: f, node } : undefined;
  };
  const editing = () => {
    const a = active();
    return a && s().editingNode() === a.node.id ? a : undefined;
  };
  /**
   * The pane goes left of the graphic (past the slide's edge when there is
   * room), else right of it, else at the left of what is visible.
   */
  const panePosition = () => {
    const f = frame();
    if (!f) return { left: 0, top: 0 };
    const sc = props.scale;
    const room = props.room?.() ?? { left: 24, right: 24 };
    const gap = 16;
    const min = 4 - room.left;
    const max = props.slideWidth * sc + room.right - 4;
    const left = f.x * sc - PANE_WIDTH - gap;
    const right = (f.x + f.w) * sc + gap;
    const x =
      left >= min ? left : right + PANE_WIDTH <= max ? right : Math.max(min, 4);
    return { left: x, top: Math.max(0, f.y * sc) };
  };
  return (
    <>
      <For each={graphics()}>
        {(shape) => (
          <For
            each={(shape.smartArt?.nodes ?? []).filter(
              (n) => !n.text.trim() && s().editingNode() !== n.id
            )}
          >
            {(node) => <Prompt shape={shape} node={node} scale={props.scale} />}
          </For>
        )}
      </For>
      <Show when={active() && !editing() ? active() : undefined}>
        {(a) => (
          <Show when={nodeBox(a().shape, a().node)}>
            {(b) => (
              <div
                aria-hidden="true"
                data-testid="pptx-smartart-active-node"
                data-node={a().node.id}
                class="pointer-events-none absolute rounded-sm border-2 border-accent border-dashed"
                style={{
                  left: px(b().x * props.scale - 2),
                  top: px(b().y * props.scale - 2),
                  width: px(b().w * props.scale + 4),
                  height: px(b().h * props.scale + 4),
                }}
              />
            )}
          </Show>
        )}
      </Show>
      <Show when={!props.readonly && editing()}>
        {(a) => (
          <NodeEditor
            smartArt={s()}
            shape={a().shape}
            node={a().node}
            scale={props.scale}
            onDone={props.onDone}
          />
        )}
      </Show>
      <Show when={frame()}>
        {(f) => (
          <button
            type="button"
            aria-label={
              s().pane.open() ? 'Hide the Text Pane' : 'Show the Text Pane'
            }
            title="Text Pane"
            data-testid="pptx-smartart-pane-toggle"
            class="absolute z-10 flex h-8 w-3.5 items-center justify-center rounded-l-sm border border-edge bg-menu text-ink-muted shadow-sm hover:text-ink"
            style={{
              left: px(f().x * props.scale - 15),
              top: px((f().y + f().h / 2) * props.scale - 16),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => s().pane.toggle()}
          >
            <Show
              when={s().pane.open()}
              fallback={<CaretRight class="size-3" />}
            >
              <CaretLeft class="size-3" />
            </Show>
          </button>
        )}
      </Show>
      <Show when={s().pane.open()}>
        <SmartArtTextPane
          smartArt={s()}
          readonly={props.readonly}
          position={panePosition()}
          onClose={() => {
            s().pane.setOpen(false);
            props.onDone();
          }}
        />
      </Show>
    </>
  );
}
