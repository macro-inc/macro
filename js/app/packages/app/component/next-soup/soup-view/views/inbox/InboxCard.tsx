import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cn } from '@ui';
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
        'group/inbox-item relative grid min-h-16 w-full grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-2 py-1.5',

        {
          'bg-accent/8': props.selected,
          'bg-accent/16': props.selected && props.highlighted,
          'bg-hover/30':
            props.highlighted && !props.selected && !isTouchDevice(),
          'hover:bg-hover/30':
            !props.highlighted && !props.selected && !isTouchDevice(),
          'opacity-75': props.dimmed,
        },
        props.class
      )}
      role={interactive() ? 'button' : undefined}
      tabIndex={interactive() ? 0 : undefined}
      onClick={props.onClick}
      onKeyDown={onKeyDown}
    >
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
        'relative grid size-10 shrink-0 place-items-center self-start overflow-visible rounded-full',
        props.class
      )}
    >
      <span class="grid size-full place-items-center overflow-hidden rounded-full bg-active text-ink-muted">
        <Show when={props.src} fallback={props.fallback}>
          {(src) => <img src={src()} alt="" class="size-full object-cover" />}
        </Show>
      </span>
      {props.children}
    </span>
  );
}

function Body(props: SlotProps): JSX.Element {
  return (
    <div class={cn('flex min-w-0 flex-col gap-1', props.class)}>
      {props.children}
    </div>
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
    <div class={cn('min-w-0 flex-1 truncate', props.class)}>
      {props.children}
    </div>
  );
}

function Content(props: SlotProps): JSX.Element {
  return <div class={cn('min-w-0', props.class)}>{props.children}</div>;
}

function Attachments(props: {
  items: InboxCardAttachment[];
  max?: number;
  class?: string;
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
        {(attachment) => (
          <Show when={attachment.src} fallback={attachment.fallback?.()}>
            {(src) => (
              <Show
                when={attachment.kind === 'video'}
                fallback={
                  <img
                    src={attachment.thumbSrc ?? src()}
                    alt={attachment.alt ?? ''}
                    loading="lazy"
                    class="size-12 rounded-lg border border-edge object-cover"
                  />
                }
              >
                <video
                  src={src()}
                  muted
                  playsinline
                  preload="metadata"
                  class="size-12 rounded-lg border border-edge object-cover"
                />
              </Show>
            )}
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
        'flex min-w-0 items-center gap-1.5 text-xs text-ink-extra-muted',
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
