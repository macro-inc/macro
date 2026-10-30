import { t } from '@app/lib/i18n';
import PushPinIcon from '@icon/system/regular/push-pin.svg';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import type { ZoomDetail } from '../core/camera';
import type { BoardItem } from '../core/item';
import type { BoardFreshness } from '../core/lifecycle';
import { AgeLabel } from './age-label';
import { KindTile } from './glyphs';
import { type AvatarComponent, MessageStack } from './message-stack';

/** The face an item shows: the other person in a DM, else its kind. */
export function ItemFace(props: {
  item: BoardItem;
  size: number;
  Avatar: AvatarComponent;
}) {
  return (
    <Show
      when={props.item.face}
      fallback={
        <KindTile
          kind={props.item.kind}
          zone={props.item.zone}
          size={props.size}
        />
      }
    >
      {(face) => <props.Avatar author={face()} size={props.size} />}
    </Show>
  );
}

/** A count of unread messages, or a dot when it is only a mention. */
export function UnreadBadge(props: { count: number; class?: string }) {
  return (
    <Show
      when={props.count > 0}
      fallback={
        <span
          aria-hidden="true"
          class={cn('size-2 shrink-0 rounded-full bg-accent', props.class)}
        />
      }
    >
      <span
        class={cn(
          'flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-contrast',
          props.class
        )}
      >
        {props.count}
      </span>
    </Show>
  );
}

/** A live dot that pings while something is happening right now. */
export function LiveDot(props: { class?: string }) {
  return (
    <span
      role="img"
      aria-label={t('board.live')}
      class={cn('relative flex size-2 shrink-0', props.class)}
    >
      <span class="absolute inset-0 animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
      <span class="relative size-2 rounded-full bg-success" />
    </span>
  );
}

/**
 * V1A's card: who and where up top, then the latest messages as a phone
 * conversation. Zoomed far out the same footprint shows only the title and
 * unread count in large type, so the map stays readable and nothing shifts.
 */
export function ConversationCard(props: {
  item: BoardItem;
  now: number;
  detail: ZoomDetail;
  freshness: BoardFreshness;
  moved: boolean;
  Avatar: AvatarComponent;
}) {
  const unread = () => props.item.unreadCount > 0 || props.item.needsYou;
  const groupConversation = () =>
    props.item.kind !== 'dm' && props.item.kind !== 'email';
  return (
    <article
      class={cn(
        'relative flex flex-col gap-2.5 rounded-2xl border bg-panel p-3 shadow-sm transition-shadow group-hover/node:shadow-md',
        props.item.needsYou
          ? 'border-[color-mix(in_oklch,var(--color-accent)_55%,var(--color-edge-muted))]'
          : 'border-edge-muted'
      )}
    >
      <div
        class={cn(
          'flex min-w-0 flex-col gap-2.5',
          props.detail === 'far' && 'invisible'
        )}
      >
        <header class="flex min-w-0 items-center gap-2">
          <ItemFace item={props.item} size={28} Avatar={props.Avatar} />
          <div class="flex min-w-0 flex-1 flex-col">
            <span
              class={cn(
                'truncate text-sm leading-5',
                unread() ? 'font-semibold text-ink' : 'font-medium text-ink'
              )}
            >
              {props.item.title}
            </span>
            <Show when={props.item.context ?? props.item.status}>
              {(context) => (
                <span class="truncate text-xs leading-4 text-ink-muted">
                  {context()}
                </span>
              )}
            </Show>
          </div>
          <div class="flex shrink-0 items-center gap-1.5 self-start pt-0.5">
            <Show when={props.moved}>
              <PushPinIcon class="size-3 text-ink-extra-muted" />
            </Show>
            <Show when={props.freshness === 'live'}>
              <LiveDot />
            </Show>
            <AgeLabel
              at={props.item.lastActivityAt}
              now={props.now}
              class="text-xs text-ink-extra-muted"
            />
            <Show when={unread()}>
              <UnreadBadge count={props.item.unreadCount} />
            </Show>
          </div>
        </header>
        <Show
          when={props.item.messages.length > 0}
          fallback={
            <p class="px-1 text-xs text-ink-extra-muted italic">
              {t('board.noMessages')}
            </p>
          }
        >
          <MessageStack
            messages={props.item.messages.slice(-3)}
            showNames={groupConversation()}
            Avatar={props.Avatar}
          />
        </Show>
      </div>
      <Show when={props.detail === 'far'}>
        <div class="absolute inset-0 flex flex-col justify-center gap-3 overflow-hidden rounded-2xl p-5">
          <div class="flex min-w-0 items-center gap-3">
            <ItemFace item={props.item} size={56} Avatar={props.Avatar} />
            <Show when={unread()}>
              <span class="ml-auto flex h-12 min-w-12 items-center justify-center rounded-full bg-accent px-3 text-2xl font-bold tabular-nums text-accent-contrast">
                {props.item.unreadCount || '•'}
              </span>
            </Show>
          </div>
          <span class="line-clamp-2 text-[32px] leading-9 font-semibold tracking-tight text-ink">
            {props.item.title}
          </span>
          <div class="flex -space-x-2">
            <For each={props.item.participants.slice(0, 5)}>
              {(person) => <props.Avatar author={person} size={36} />}
            </For>
          </div>
        </div>
      </Show>
    </article>
  );
}
