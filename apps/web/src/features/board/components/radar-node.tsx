import { cn } from '@ui';
import { Show } from 'solid-js';
import type { BoardItem } from '../core/item';
import { AgeLabel } from './age-label';
import { ConversationFace } from './bubble-face';
import type { AvatarComponent } from './message-stack';
import { SpeechBubble } from './speech-bubble';

export const RADAR_FACE_SIZE = 44;

const side = (value: number) => (value > 0.35 ? 1 : value < -0.35 ? -1 : 0);

/**
 * V1D's node: a face on its ring, with its name and newest message
 * radiating outward from the center so neighbors on a ring stay apart.
 * `angle` is in radians, clockwise from the top.
 */
export function RadarNode(props: {
  item: BoardItem;
  angle: number;
  now: number;
  /** The camera's scale; text grows a little when zoomed out. */
  scale: number;
  live: boolean;
  Avatar: AvatarComponent;
}) {
  const unread = () => props.item.unreadCount > 0 || props.item.needsYou;
  const outward = () => ({
    x: Math.sin(props.angle),
    y: -Math.cos(props.angle),
  });
  // Which way the label hangs off the face: -1, 0 or 1 on each axis.
  const anchor = () => ({
    x: side(outward().x),
    y: side(outward().y),
  });
  const lift = () => Math.min(1.5, Math.max(1, 0.8 / props.scale));
  const latest = () => props.item.messages.at(-1);
  // Zoomed out, only what matters keeps its name, like labels on a map.
  const named = () => props.scale >= 0.42 || unread() || props.live;
  return (
    <div
      class="relative rounded-full"
      style={{
        width: `${RADAR_FACE_SIZE}px`,
        height: `${RADAR_FACE_SIZE}px`,
      }}
    >
      <Show when={props.live}>
        <span class="absolute -inset-1.5 animate-ping rounded-full border-2 border-success opacity-40 motion-reduce:animate-none" />
      </Show>
      <span
        class={cn(
          'block rounded-full transition-shadow group-hover/node:shadow-lg',
          props.item.needsYou &&
            'shadow-[0_0_0_3px_var(--color-page),0_0_0_5px_var(--color-accent)]'
        )}
      >
        <ConversationFace
          item={props.item}
          size={RADAR_FACE_SIZE}
          Avatar={props.Avatar}
        />
      </span>
      <Show when={props.item.unreadCount > 0}>
        <span class="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-contrast shadow-[0_0_0_2px_var(--color-page)]">
          {props.item.unreadCount}
        </span>
      </Show>
      <div
        class="absolute flex w-max max-w-40 flex-col gap-1"
        classList={{
          'items-start': anchor().x === 1,
          'items-end': anchor().x === -1,
          'items-center': anchor().x === 0,
        }}
        style={{
          left: `${RADAR_FACE_SIZE / 2 + outward().x * (RADAR_FACE_SIZE / 2 + 10)}px`,
          top: `${RADAR_FACE_SIZE / 2 + outward().y * (RADAR_FACE_SIZE / 2 + 10)}px`,
          // Hang the label off the face on the side away from the center,
          // growing from the point where it touches the face.
          translate: `${-50 + 50 * anchor().x}% ${-50 + 50 * anchor().y}%`,
          scale: String(lift()),
          'transform-origin': `${50 - 50 * anchor().x}% ${50 - 50 * anchor().y}%`,
        }}
      >
        <span
          class="flex max-w-full min-w-0 items-center gap-1 text-xs whitespace-nowrap"
          classList={{ invisible: !named() }}
        >
          <Show when={unread()}>
            <span
              aria-hidden="true"
              class="size-1.5 shrink-0 rounded-full bg-accent"
            />
          </Show>
          <span
            class={cn(
              'truncate',
              unread() ? 'font-semibold text-ink' : 'text-ink-muted'
            )}
          >
            {props.item.title}
          </span>
          <AgeLabel
            at={props.item.lastActivityAt}
            now={props.now}
            class="text-[10px] text-ink-extra-muted"
          />
        </span>
        <Show when={props.scale >= 0.42 && latest()}>
          {(message) => (
            <SpeechBubble
              text={message().text}
              tone={message().author ? 'incoming' : 'system'}
              size="sm"
              lines={1}
              unread={message().unread}
              class="shadow-sm"
            />
          )}
        </Show>
      </div>
    </div>
  );
}
