import PushPinIcon from '@icon/system/regular/push-pin.svg';
import { cn } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type { ZoomDetail } from '../core/camera';
import type { BoardItem } from '../core/item';
import type { BoardFreshness } from '../core/lifecycle';
import { AgeLabel } from './age-label';
import { ItemFace, LiveDot, UnreadBadge } from './conversation-card';
import { zoneColor } from './glyphs';
import type { AvatarComponent } from './message-stack';
import { bubbleTone, SpeechBubble } from './speech-bubble';

/**
 * V1C's chip: what it is, when, and the newest message. Its right edge,
 * marked in the zone's hue, is the moment it happened on the river.
 */
export function RiverChip(props: {
  item: BoardItem;
  now: number;
  detail: ZoomDetail;
  freshness: BoardFreshness;
  moved: boolean;
  Avatar: AvatarComponent;
}) {
  const latest = () => props.item.messages.at(-1);
  const unread = () => props.item.unreadCount > 0 || props.item.needsYou;
  return (
    <article
      class={cn(
        'relative flex flex-col gap-2 overflow-hidden rounded-xl border bg-panel p-2.5 pr-3 shadow-sm transition-shadow group-hover/node:shadow-md',
        props.item.needsYou
          ? 'border-[color-mix(in_oklch,var(--color-accent)_55%,var(--color-edge-muted))]'
          : 'border-edge-muted'
      )}
      style={{ '--board-zone': zoneColor(props.item.zone) }}
    >
      <span
        aria-hidden="true"
        class="absolute inset-y-0 right-0 w-1 bg-[color-mix(in_oklch,var(--board-zone)_70%,transparent)]"
      />
      <div
        class={cn(
          'flex min-w-0 flex-col gap-2',
          props.detail === 'far' && 'invisible'
        )}
      >
        <header class="flex min-w-0 items-center gap-2">
          <ItemFace item={props.item} size={22} Avatar={props.Avatar} />
          <span
            class={cn(
              'min-w-0 flex-1 truncate text-[13px] leading-4 text-ink',
              unread() ? 'font-semibold' : 'font-medium'
            )}
          >
            {props.item.title}
          </span>
          <Show when={props.moved}>
            <PushPinIcon class="size-3 shrink-0 text-ink-extra-muted" />
          </Show>
          <Show when={props.freshness === 'live'}>
            <LiveDot />
          </Show>
          <AgeLabel
            at={props.item.lastActivityAt}
            now={props.now}
            class="text-[11px] text-ink-extra-muted"
          />
          <Show when={unread()}>
            <UnreadBadge count={props.item.unreadCount} />
          </Show>
        </header>
        <Show when={latest()}>
          {(message) => (
            <div class="flex min-w-0 items-end gap-1.5">
              <Switch>
                <Match
                  when={
                    bubbleTone(message()) === 'incoming' && message().author
                  }
                >
                  {(author) => <props.Avatar author={author()} size={18} />}
                </Match>
              </Switch>
              <SpeechBubble
                text={message().text}
                tone={bubbleTone(message())}
                tail
                size="sm"
                lines={2}
                unread={message().unread}
                class={bubbleTone(message()) === 'outgoing' ? 'ml-auto' : ''}
              />
            </div>
          )}
        </Show>
      </div>
      <Show when={props.detail === 'far'}>
        <div class="absolute inset-0 flex items-center gap-3 px-4">
          <ItemFace item={props.item} size={44} Avatar={props.Avatar} />
          <span class="line-clamp-2 text-[26px] leading-7 font-semibold tracking-tight text-ink">
            {props.item.title}
          </span>
        </div>
      </Show>
    </article>
  );
}
