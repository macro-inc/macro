import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { Button, cn } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import type { FeedDay } from '../core/feed';
import { type BoardItem, latestMessage } from '../core/item';
import type { BoardFreshness } from '../core/lifecycle';
import { AgeLabel } from './age-label';
import { ItemFace, LiveDot, UnreadBadge } from './conversation-card';
import { type AvatarComponent, MessageStack } from './message-stack';

/** How much of each conversation a list shows, from least to most. */
export type FeedDensity = 'headlines' | 'digest' | 'threads';

/** What a list draws for one item. */
export type FeedItemProps = {
  item: BoardItem;
  now: number;
  freshness: BoardFreshness;
  /** The list's keyboard focus or the pointer is on it. */
  highlighted: boolean;
  Avatar: AvatarComponent;
};

const isUnread = (item: BoardItem) => item.unreadCount > 0 || item.needsYou;

/** Group conversations name who spoke; a direct message or email needs no names. */
const namesSpeakers = (item: BoardItem) =>
  item.kind !== 'dm' && item.kind !== 'email';

/** Every row sits in one centered column, wider when it says less. */
function FeedColumn(props: {
  density: FeedDensity;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'mx-auto w-full px-4',
        match(props.density)
          .with('headlines', () => 'max-w-4xl')
          .with('digest', () => 'max-w-3xl')
          .with('threads', () => 'max-w-2xl')
          .exhaustive(),
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

/**
 * One item's row in the list grid. The grid tracks which row has keyboard
 * focus, so the row itself never takes focus.
 */
export function FeedItemFrame(props: {
  id: string;
  label: string;
  density: FeedDensity;
  onHover: () => void;
  onOpen: () => void;
  children: JSX.Element;
}) {
  return (
    <div id={props.id} role="row" aria-label={props.label}>
      <FeedColumn
        density={props.density}
        class={props.density === 'threads' ? 'py-1.5' : 'py-px'}
      >
        <div
          role="gridcell"
          onMouseMove={() => props.onHover()}
          onClick={() => props.onOpen()}
        >
          {props.children}
        </div>
      </FeedColumn>
    </div>
  );
}

export function dayName(day: FeedDay): string {
  return match(day)
    .with('today', () => t('board.dayToday'))
    .with('yesterday', () => t('board.dayYesterday'))
    .with('week', () => t('board.dayWeek'))
    .with('older', () => t('board.dayOlder'))
    .exhaustive();
}

/** The heading over a stretch of days. */
export function FeedDayHeading(props: {
  day: FeedDay;
  first: boolean;
  density: FeedDensity;
}) {
  return (
    <div role="row">
      <FeedColumn density={props.density}>
        <div
          role="gridcell"
          class={cn(
            'px-3 pb-1.5 text-xs font-semibold text-ink-extra-muted',
            props.first ? 'pt-3' : 'pt-6'
          )}
        >
          {dayName(props.day)}
        </div>
      </FeedColumn>
    </div>
  );
}

/** What the end of the list says: more is coming, can come, or that's all. */
export type FeedEndState = 'loading' | 'more' | 'end';

export function FeedEnd(props: {
  state: FeedEndState;
  density: FeedDensity;
  onLoadOlder: () => void;
}) {
  return (
    <div role="row">
      <FeedColumn density={props.density}>
        <div
          role="gridcell"
          class="flex h-20 items-center justify-center gap-2 text-xs text-ink-extra-muted"
        >
          <Switch>
            <Match when={props.state === 'loading'}>
              <SpinnerIcon class="size-4 animate-spin motion-reduce:animate-none" />
              <span role="status">{t('board.loadingOlder')}</span>
            </Match>
            <Match when={props.state === 'more'}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => props.onLoadOlder()}
              >
                {t('board.loadOlder')}
              </Button>
            </Match>
            <Match when={props.state === 'end'}>
              <span>{t('board.feedEnd')}</span>
            </Match>
          </Switch>
        </div>
      </FeedColumn>
    </div>
  );
}

/** Where the first rows will land, while they load. */
export function FeedSkeleton(props: { density: FeedDensity; label: string }) {
  return (
    <ListSkeleton.Root label={props.label} class="size-full overflow-hidden">
      <FeedColumn density={props.density} class="pt-3">
        <ListSkeleton.Bar class="mx-3 mb-3 w-14" />
        <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
          {(index) => (
            <Switch>
              <Match when={props.density === 'headlines'}>
                <div class="flex h-10 items-center gap-2.5 px-3 touch:h-11">
                  <ListSkeleton.Bar class="size-5" />
                  <ListSkeleton.Bar class={index % 2 ? 'w-24' : 'w-36'} />
                  <ListSkeleton.Bar class={index % 3 ? 'w-64' : 'w-48'} />
                  <ListSkeleton.Bar class="ml-auto w-8" />
                </div>
              </Match>
              <Match when={props.density === 'digest'}>
                <div class="flex gap-3 px-3 py-2.5">
                  <ListSkeleton.Bar class="size-9 shrink-0" />
                  <div class="flex flex-1 flex-col gap-2.5 pt-1">
                    <ListSkeleton.Bar class={index % 2 ? 'w-28' : 'w-40'} />
                    <ListSkeleton.Bar class={index % 3 ? 'w-3/4' : 'w-1/2'} />
                  </div>
                </div>
              </Match>
              <Match when={props.density === 'threads'}>
                <div class="py-1.5">
                  <div class="flex flex-col gap-3 rounded-2xl border border-edge-muted p-4">
                    <div class="flex items-center gap-2.5">
                      <ListSkeleton.Bar class="size-8" />
                      <ListSkeleton.Bar class={index % 2 ? 'w-28' : 'w-40'} />
                    </div>
                    <ListSkeleton.Bar class="ml-7 h-8 w-2/3 rounded-[18px]" />
                    <ListSkeleton.Bar class="ml-7 h-8 w-1/2 rounded-[18px]" />
                  </div>
                </div>
              </Match>
            </Switch>
          )}
        </For>
      </FeedColumn>
    </ListSkeleton.Root>
  );
}

/** The latest message, after who said it when the face doesn't say. */
function LatestText(props: { item: BoardItem; class?: string }) {
  const message = () => latestMessage(props.item);
  const speaker = () => {
    const author = message()?.author;
    if (!author) return undefined;
    if (author.isSelf) return t('board.you');
    return namesSpeakers(props.item) ? author.name : undefined;
  };
  return (
    <Show
      when={message()}
      fallback={
        <span class={props.class}>
          {props.item.context ?? props.item.status}
        </span>
      }
    >
      {(latest) => (
        <span class={props.class}>
          <Show when={speaker()}>
            {(name) => (
              <span class="font-medium text-ink">
                {t('board.speaker', { name: name() })}{' '}
              </span>
            )}
          </Show>
          {latest().text}
        </span>
      )}
    </Show>
  );
}

function StatusChip(props: { children: JSX.Element }) {
  return (
    <span class="shrink-0 rounded-full border border-edge-muted px-1.5 text-[11px] leading-4 text-ink-muted">
      {props.children}
    </span>
  );
}

function NeedsYouChip() {
  return (
    <span class="shrink-0 rounded-full bg-accent-bg px-1.5 text-[11px] leading-4 font-medium text-accent">
      {t('board.needsYou')}
    </span>
  );
}

/**
 * Where it happens and what state it's in, beside or under the title. The
 * place keeps the room it needs; the context gives way first.
 */
function ItemDetails(props: { item: BoardItem; class?: string }) {
  return (
    <Show when={props.item.context || props.item.status || props.item.needsYou}>
      <span class={cn('min-w-0 items-center gap-1.5', props.class)}>
        <Show when={props.item.context}>
          {(context) => (
            <span class="min-w-0 truncate text-xs leading-4 text-ink-muted">
              {context()}
            </span>
          )}
        </Show>
        <Show when={props.item.status}>
          {(status) => <StatusChip>{status()}</StatusChip>}
        </Show>
        <Show when={props.item.needsYou}>
          <NeedsYouChip />
        </Show>
      </span>
    </Show>
  );
}

/**
 * Live, age and unread count, at the end of a row's first line. A mention
 * with nothing unread shows a dot unless the row names it already.
 */
function ItemMeta(props: FeedItemProps & { needsYouShown: boolean }) {
  return (
    <span class="flex shrink-0 items-center gap-1.5">
      <Show when={props.freshness === 'live'}>
        <LiveDot />
      </Show>
      <AgeLabel
        at={props.item.lastActivityAt}
        now={props.now}
        class="text-xs text-ink-extra-muted"
      />
      <Show
        when={
          props.needsYouShown
            ? props.item.unreadCount > 0
            : isUnread(props.item)
        }
      >
        <UnreadBadge count={props.item.unreadCount} />
      </Show>
    </span>
  );
}

function ItemTitle(props: { item: BoardItem; class?: string }) {
  return (
    <span
      class={cn(
        'truncate text-sm text-ink',
        isUnread(props.item) ? 'font-semibold' : 'font-medium',
        props.class
      )}
    >
      {props.item.title}
    </span>
  );
}

/** V2A: one line per conversation, its latest message trailing the title. */
export function HeadlineRow(props: FeedItemProps) {
  return (
    <div
      class={cn(
        'flex h-10 min-w-0 items-center gap-2.5 rounded-lg px-3 touch:h-11',
        props.highlighted
          ? 'bg-list-highlighted'
          : 'not-touch:hover:bg-list-hover'
      )}
    >
      <ItemFace item={props.item} size={20} Avatar={props.Avatar} />
      <ItemTitle item={props.item} class="max-w-[45%] shrink-0" />
      <LatestText
        item={props.item}
        class="min-w-0 flex-1 truncate text-sm text-ink-muted"
      />
      <ItemMeta {...props} needsYouShown={false} />
    </div>
  );
}

/**
 * V2B: who said the latest thing in each conversation, over two lines. A
 * narrow row moves the details under the title.
 */
export function DigestRow(props: FeedItemProps) {
  return (
    <div
      class={cn(
        'flex min-w-0 gap-3 rounded-xl px-3 py-2.5',
        props.highlighted
          ? 'bg-list-highlighted'
          : 'not-touch:hover:bg-list-hover'
      )}
    >
      <ItemFace item={props.item} size={36} Avatar={props.Avatar} />
      <div class="@container/digest flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-2">
          <ItemTitle item={props.item} class="min-w-0" />
          <ItemDetails item={props.item} class="hidden @xl/digest:flex" />
          <span class="flex-1" />
          <ItemMeta {...props} needsYouShown />
        </div>
        <ItemDetails item={props.item} class="flex @xl/digest:hidden" />
        <LatestText
          item={props.item}
          class="line-clamp-2 text-[13px] leading-[18px] text-ink-muted"
        />
      </div>
    </div>
  );
}

/** V2C: a conversation's recent messages in full, as a card. */
export function ThreadCard(props: FeedItemProps) {
  return (
    <article
      class={cn(
        'flex min-w-0 flex-col gap-3 rounded-2xl border bg-panel p-4 transition-shadow',
        props.highlighted ? 'shadow-md' : 'shadow-xs',
        props.item.needsYou
          ? 'border-[color-mix(in_oklch,var(--color-accent)_55%,var(--color-edge-muted))]'
          : props.highlighted
            ? 'border-edge'
            : 'border-edge-muted'
      )}
    >
      <header class="flex min-w-0 items-center gap-2.5">
        <ItemFace item={props.item} size={32} Avatar={props.Avatar} />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <ItemTitle item={props.item} class="leading-5" />
          <ItemDetails item={props.item} class="flex" />
        </div>
        <span class="self-start pt-0.5">
          <ItemMeta {...props} needsYouShown />
        </span>
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
          messages={props.item.messages}
          showNames={namesSpeakers(props.item)}
          Avatar={props.Avatar}
          lines={4}
        />
      </Show>
    </article>
  );
}
