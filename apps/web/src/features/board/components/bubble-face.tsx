import { cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { BoardAuthor, BoardItem } from '../core/item';
import { BUBBLE_CELL_WIDTH } from '../core/layout-bubbles';
import { AgeLabel } from './age-label';
import { KindTile, kindGlyph, zoneColor } from './glyphs';
import type { AvatarComponent } from './message-stack';
import { bubbleTone, SpeechBubble } from './speech-bubble';

/** Where three faces sit inside a group circle: center x, center y, diameter. */
const GROUP_SLOTS = [
  [0.34, 0.36, 0.5],
  [0.7, 0.44, 0.42],
  [0.42, 0.74, 0.38],
] as const;

/**
 * The people in a conversation inside one circle, the way a phone shows a
 * group thread: up to three faces, the newest speaker largest.
 */
function GroupFace(props: {
  item: BoardItem;
  people: BoardAuthor[];
  size: number;
  Avatar: AvatarComponent;
}) {
  return (
    <span
      class="relative block rounded-full bg-[color-mix(in_oklch,var(--board-zone)_16%,var(--color-panel))]"
      style={{
        '--board-zone': zoneColor(props.item.zone),
        width: `${props.size}px`,
        height: `${props.size}px`,
      }}
    >
      <For each={props.people.slice(0, 3)}>
        {(person, index) => {
          const slot = () => GROUP_SLOTS[index()];
          const diameter = () => props.size * slot()[2];
          return (
            <span
              class="absolute rounded-full shadow-[0_0_0_2px_var(--color-page)]"
              style={{
                left: `${props.size * slot()[0] - diameter() / 2}px`,
                top: `${props.size * slot()[1] - diameter() / 2}px`,
              }}
            >
              <props.Avatar author={person} size={diameter()} />
            </span>
          );
        }}
      </For>
      <span
        class="absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full bg-panel text-[color-mix(in_oklch,var(--board-zone)_80%,var(--color-ink))] shadow-[0_0_0_2px_var(--color-page)]"
        style={{
          width: `${Math.max(16, props.size * 0.3)}px`,
          height: `${Math.max(16, props.size * 0.3)}px`,
        }}
      >
        <Dynamic
          component={kindGlyph(props.item.kind)}
          style={{
            width: `${Math.max(9, props.size * 0.16)}px`,
            height: `${Math.max(9, props.size * 0.16)}px`,
          }}
        />
      </span>
    </span>
  );
}

/**
 * The face an item shows on Bubbles and Radar: the other person in a DM,
 * the sender of an email or agent run, a group of faces for a busy channel,
 * else the item's kind.
 */
export function ConversationFace(props: {
  item: BoardItem;
  size: number;
  Avatar: AvatarComponent;
}) {
  const others = () =>
    props.item.participants.filter((person) => !person.isSelf);
  const lead = () =>
    props.item.face ??
    (props.item.kind === 'email' || props.item.kind === 'agent'
      ? others()[0]
      : undefined);
  return (
    <Switch
      fallback={
        <KindTile
          kind={props.item.kind}
          zone={props.item.zone}
          size={props.size}
        />
      }
    >
      <Match when={lead()}>
        {(author) => <props.Avatar author={author()} size={props.size} />}
      </Match>
      <Match when={others().length >= 2}>
        <GroupFace
          item={props.item}
          people={others()}
          size={props.size}
          Avatar={props.Avatar}
        />
      </Match>
    </Switch>
  );
}

/** Which bubbles stay up as the viewer zooms out, like labels on a map. */
function bubbleShown(item: BoardItem, live: boolean, scale: number): boolean {
  if (scale >= 0.8) return true;
  if (scale >= 0.42) return live || item.needsYou || item.unreadCount > 0;
  return live || item.needsYou;
}

/**
 * V1B's node: a face sized by how loud the conversation is, its newest
 * message popping out above like a pinned conversation, and its name below.
 * Bubbles and names grow as the board zooms out so they stay legible, and
 * only the conversations that matter most keep theirs.
 */
export function BubbleFace(props: {
  item: BoardItem;
  r: number;
  now: number;
  /** The camera's scale, so text can stay a readable size on screen. */
  scale: number;
  live: boolean;
  Avatar: AvatarComponent;
}) {
  const unread = () => props.item.unreadCount > 0 || props.item.needsYou;
  const lift = () => Math.min(1.5, Math.max(1, 0.85 / props.scale));
  const latest = () =>
    bubbleShown(props.item, props.live, props.scale)
      ? props.item.messages.at(-1)
      : undefined;
  return (
    <div
      class="relative rounded-full"
      style={{ width: `${props.r * 2}px`, height: `${props.r * 2}px` }}
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
          size={props.r * 2}
          Avatar={props.Avatar}
        />
      </span>
      <Show when={props.item.unreadCount > 0}>
        <span
          class="absolute -top-0.5 -left-0.5 flex h-5 min-w-5 origin-top-left items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-contrast shadow-[0_0_0_2px_var(--color-page)]"
          style={{ scale: String(lift()) }}
        >
          {props.item.unreadCount}
        </span>
      </Show>

      <Show when={latest()}>
        {(message) => (
          <div
            class="absolute bottom-[80%] left-[58%] z-10 w-max origin-bottom-left"
            style={{
              // Lifted bubbles may not reach into the next face's cell.
              'max-width': `${Math.min(150, (BUBBLE_CELL_WIDTH - 24) / lift())}px`,
              scale: String(lift()),
            }}
          >
            <SpeechBubble
              text={message().text}
              tone={bubbleTone(message()) === 'system' ? 'system' : 'incoming'}
              tail
              lines={props.scale >= 1.1 ? 3 : 2}
              unread={message().unread}
              class="shadow-sm"
            />
          </div>
        )}
      </Show>

      <div
        class="absolute top-full left-1/2 flex origin-top -translate-x-1/2 items-center justify-center gap-1.5 pt-2 text-[13px] whitespace-nowrap"
        style={{
          // Names may not outgrow their cell once lifted.
          'max-width': `${(BUBBLE_CELL_WIDTH - 12) / lift()}px`,
          scale: String(lift()),
        }}
      >
        <Show when={unread()}>
          <span
            aria-hidden="true"
            class="size-2 shrink-0 rounded-full bg-accent"
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
        <Show when={props.scale >= 1.1}>
          <AgeLabel
            at={props.item.lastActivityAt}
            now={props.now}
            class="text-[11px] text-ink-extra-muted"
          />
        </Show>
      </div>
    </div>
  );
}
