import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cn, Layer } from '@ui';
import { For, type JSX, Show } from 'solid-js';

interface SlotProps {
  class?: string;
  children?: JSX.Element;
}

export interface InboxCardAttachment {
  id: string;
  /** Media url; when absent, `fallback` fills the tile instead. */
  src?: string;
  kind?: 'image' | 'video';
  thumbSrc?: string;
  alt?: string;
  /** Tile contents when there's no `src` (e.g. a non-media entity preview). */
  fallback?: () => JSX.Element;
}

interface RootProps extends SlotProps {
  /** De-emphasize the row (e.g. already read). */
  dimmed?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  onClick?: (event: MouseEvent) => void;
  /** Set false when a parent list owns keyboard focus and activation. */
  focusable?: boolean;
}

function Root(props: RootProps): JSX.Element {
  const interactive = (): boolean => Boolean(props.onClick);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!interactive()) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    props.onClick?.(event as unknown as MouseEvent);
  };

  return (
    <div
      class={cn(
        // The left padding reserves a fixed column for the select checkbox
        // (rendered by the row wrapper) so content never reflows when it
        // appears on hover. It comes from the --soup-row-* geometry in
        // ListEntity.css — which also carries the mobile rail value — so group
        // headers can line their label up with this card's content.
        'group/inbox-item relative min-h-16 grid w-full grid-cols-[2rem_minmax(0,1fr)_max-content] grid-rows-[min-content_min-content] items-start gap-x-3 rounded-lg py-2.5 pr-2 pl-(--soup-row-padding-l)',
        // Mobile renders the same cards in slightly different visual
        // language: a full-bleed row whose left rail holds the unread dot
        // (see the span below) instead of the checkbox gutter, with the
        // avatar column centered against the content. The --soup-inbox-*
        // vars come from `.soup-list-entity` on the row wrapper.
        'mobile:rounded-none mobile:grid-cols-[auto_minmax(0,1fr)_max-content] mobile:items-center mobile:content-center mobile:pr-3',
        {
          'bg-list-selected': props.selected,
          'bg-list-selected-highlighted': props.selected && props.highlighted,
          'bg-list-highlighted':
            props.highlighted && !props.selected && !isTouchDevice(),
          'hover:bg-list-hover':
            !props.highlighted && !props.selected && !isTouchDevice(),
        },
        props.class
      )}
      data-unread={props.dimmed ? undefined : true}
      role={interactive() && props.focusable !== false ? 'button' : undefined}
      tabIndex={interactive() && props.focusable !== false ? 0 : undefined}
      onClick={props.onClick}
      onKeyDown={onKeyDown}
    >
      {/* Mobile-only unread dot in the left rail. */}
      <span
        aria-hidden="true"
        class="absolute left-(--soup-inbox-unread-indicator-padding-x) top-1/2 hidden size-(--soup-inbox-unread-indicator-diameter) -translate-y-1/2 rounded-full bg-accent opacity-0 group-data-unread/inbox-item:opacity-100 mobile:block"
      />
      {props.children}
    </div>
  );
}

interface IconProps extends SlotProps {
  /** Avatar image url; falls back to `fallback` when absent. */
  src?: string;
  /** Shown when there's no `src` (e.g. initials or an icon). */
  fallback?: JSX.Element;
}

function Icon(props: IconProps): JSX.Element {
  return (
    <span
      class={cn(
        'relative grid size-8 shrink-0 place-items-center self-start overflow-visible mobile:size-(--soup-inbox-icon-diameter)',
        props.class
      )}
    >
      <Layer depth={3}>
        <span class="grid size-full place-items-center overflow-hidden rounded-full bg-surface text-ink-extra-muted">
          <Show when={props.src} fallback={props.fallback}>
            {(src) => <img src={src()} alt="" class="size-full object-cover" />}
          </Show>
        </span>
      </Layer>
      {props.children}
    </span>
  );
}

function Body(props: SlotProps): JSX.Element {
  return (
    <div class={cn('flex min-w-0 flex-col', props.class)}>{props.children}</div>
  );
}

function Header(props: SlotProps): JSX.Element {
  return (
    <div class={cn('flex min-w-0 items-center gap-1 text-sm', props.class)}>
      {props.children}
    </div>
  );
}

function Title(props: SlotProps): JSX.Element {
  return (
    <div
      class={cn(
        'min-w-0 flex-1 truncate text-sm font-normal text-ink-extra-muted group-data-unread/inbox-item:text-ink group-data-unread/inbox-item:font-medium',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function Content(props: SlotProps): JSX.Element {
  return (
    <div
      class={cn(
        'min-w-0 text-ink-extra-muted/80 group-data-unread/inbox-item:text-ink-muted',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function Attachments(props: {
  items: InboxCardAttachment[];
  max?: number;
  class?: string;
  /** When set, media tiles become clickable and call this with the item index. */
  onOpen?: (index: number) => void;
}): JSX.Element {
  const max = (): number => props.max ?? 4;
  const visible = (): InboxCardAttachment[] => props.items.slice(0, max());
  const overflow = (): number =>
    Math.max(props.items.length - visible().length, 0);

  return (
    <div
      class={cn('flex max-w-full flex-wrap items-center gap-1.5', props.class)}
    >
      <For each={visible()}>
        {(attachment, index) => (
          <Show when={attachment.src} fallback={attachment.fallback?.()}>
            {(src) => {
              const media = () =>
                attachment.kind === 'video' ? (
                  <video
                    src={src()}
                    muted
                    playsinline
                    preload="metadata"
                    class="size-12 rounded-lg border border-edge object-cover"
                  />
                ) : (
                  <img
                    src={attachment.thumbSrc ?? src()}
                    alt={attachment.alt ?? ''}
                    loading="lazy"
                    class="size-12 rounded-lg border border-edge object-cover"
                  />
                );

              return props.onOpen ? (
                <button
                  type="button"
                  class="rounded-lg transition-opacity hover:opacity-80"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onOpen?.(index());
                  }}
                >
                  {media()}
                </button>
              ) : (
                media()
              );
            }}
          </Show>
        )}
      </For>
      <Show when={overflow() > 0}>
        <div class="grid size-12 place-items-center rounded-lg border border-edge bg-surface text-xs font-medium text-ink-muted">
          +{overflow()}
        </div>
      </Show>
    </div>
  );
}

interface MetaProps extends SlotProps {
  timestamp?: string;
}

function Meta(props: MetaProps): JSX.Element {
  return (
    <div
      class={cn(
        'flex min-w-0 items-center gap-1.5 text-xs text-ink-extra-muted mt-1',
        props.class
      )}
    >
      <Show when={props.timestamp}>
        <span class="shrink-0">{props.timestamp}</span>
      </Show>
      {props.children}
    </div>
  );
}

export const InboxCard = {
  Root,
  Icon,
  Body,
  Header,
  Title,
  Content,
  Attachments,
  Meta,
};
