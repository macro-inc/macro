/**
 * Comment markers on the slide: a speech bubble where each thread is
 * anchored (the top-right corner of its shape, its position, or the slide's
 * top-left corner). Clicking one opens its thread in the Comments pane.
 */

import type { CommentOutline, ShapeOutline } from '@core/pptx-engine/types';
import ChatIcon from '@phosphor/chat.svg';
import ChatFill from '@phosphor-fill/chat-fill.svg';
import { For, Show } from 'solid-js';
import { stackMarkers } from '../core/comments';
import { markerPoint } from '../primitives/create-comments';

/** Marker size in CSS pixels. */
const SIZE = 22;

export function CommentMarkers(props: {
  threads: CommentOutline[];
  /** CSS pixels per slide point. */
  scale: number;
  /** The slide's size in CSS pixels (markers stay on it). */
  width: number;
  height: number;
  findShape: (id: number) => ShapeOutline | undefined;
  selected: string | null;
  /** A comment being written: its marker shows where it will go. */
  draft?: { shape?: number };
  onPick: (id: string) => void;
}) {
  /** Top-left corners in CSS pixels: the threads', then the draft's. */
  const positions = () => {
    const s = props.scale || 1;
    const anchors: { shape?: number; x?: number; y?: number }[] = [
      ...props.threads,
      ...(props.draft ? [props.draft] : []),
    ];
    const corners = anchors.map((t) => {
      const p = markerPoint(t, props.findShape);
      // Beside a shape's top-right corner; at a position or the slide's corner.
      const onShape = t.shape !== undefined && !!props.findShape(t.shape);
      return onShape ? { x: p.x + 2 / s, y: p.y - SIZE / 2 / s } : p;
    });
    const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
    return stackMarkers(corners, s, SIZE).map((p) => ({
      x: clamp(p.x, props.width - SIZE),
      y: clamp(p.y, props.height - SIZE),
    }));
  };
  return (
    <div
      class="pointer-events-none absolute inset-0 z-[5]"
      data-testid="pptx-comment-markers"
    >
      <For each={props.threads}>
        {(thread, i) => {
          const at = () => positions()[i()] ?? { x: 0, y: 0 };
          const active = () => props.selected === thread.id;
          return (
            <button
              type="button"
              class="pointer-events-auto absolute flex items-center justify-center rounded-md drop-shadow"
              classList={{
                // Markers sit on the slide, so they keep PowerPoint's light
                // bubble whatever the app theme.
                'text-accent': active(),
                'text-[#5f5f5f] hover:text-[#262626]': !active(),
                'opacity-60': thread.resolved && !active(),
              }}
              style={{
                left: `${at().x}px`,
                top: `${at().y}px`,
                width: `${SIZE}px`,
                height: `${SIZE}px`,
              }}
              title={`${thread.author}: ${thread.text}`}
              aria-label={`Comment by ${thread.author}`}
              aria-pressed={active()}
              data-testid="pptx-comment-marker"
              data-comment-id={thread.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                props.onPick(thread.id);
              }}
            >
              <span class="relative flex size-full items-center justify-center">
                <ChatFill class="absolute size-full text-[white]" />
                <Show
                  when={active()}
                  fallback={<ChatIcon class="absolute size-full" />}
                >
                  <ChatFill class="absolute size-full" />
                </Show>
              </span>
            </button>
          );
        }}
      </For>
      <Show when={props.draft}>
        {(_) => {
          const at = () => positions()[props.threads.length] ?? { x: 0, y: 0 };
          return (
            <span
              class="absolute text-accent drop-shadow"
              style={{
                left: `${at().x}px`,
                top: `${at().y}px`,
                width: `${SIZE}px`,
                height: `${SIZE}px`,
              }}
              data-testid="pptx-comment-marker-draft"
            >
              <ChatFill class="size-full" />
            </span>
          );
        }}
      </Show>
    </div>
  );
}
