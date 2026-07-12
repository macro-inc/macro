import { ItemPreview } from '@core/component/ItemPreview';
import type { ItemType } from '@service-storage/client';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import type { EntityRef, WidgetOf } from '../schema';
import { TEXT } from '../tokens';

export type TimelineProps = Omit<WidgetOf<'timeline'>, 'type'>;

type TimelineEvent = TimelineProps['events'][number];

/** Map a schema EntityType onto the ItemType string ItemPreview expects. */
function toItemType(type: EntityRef['type']): string {
  switch (type) {
    case 'email_thread':
      return 'email';
    case 'foreign_entity':
      return 'foreign';
    default:
      return type;
  }
}

/**
 * Left gutter for a single timeline item: a dot offset down to line up with the
 * item's first text line, with two in-flow connector segments around it so the
 * rail reads as one continuous dot-to-dot line with no gaps.
 *
 * The top connector both pushes the dot down to the time text's baseline and
 * connects upward to the previous row's line (drawn only when not the first
 * item; a transparent spacer of the same height otherwise). The bottom connector
 * fills the remaining row height down to the next dot, suppressed on the last
 * item. Colours are driven by each row's own `future` flag: past events use the
 * accent colour, future events use muted edge.
 *
 * The column stretches to the full item height (via the parent flex row), so the
 * bottom connector reaches through the content's bottom padding to the next dot.
 */
/**
 * Each connecting segment is coloured by the dot it leads INTO (the lower dot):
 * a segment ending at a future dot is gray, so only segments between two past
 * events are accent. The top connector leads into THIS dot (own `future`); the
 * bottom connector leads into the NEXT dot (`nextFuture`).
 *
 * Lines are filled 1px `bg` spans, not `border-l` — a border-left on a `w-0` box
 * doesn't paint its full height, which left a gap above each dot.
 */
function Rail(props: {
  future?: boolean;
  nextFuture?: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const lineColor = (gray?: boolean) => (gray ? 'bg-edge-muted' : 'bg-accent');
  return (
    <div
      aria-hidden="true"
      class="flex w-3 shrink-0 flex-col items-center self-stretch"
    >
      {/* Top connector: offsets the dot down to the first text line and
			    connects up from the previous dot (line only when not the first). */}
      <span class={cn('h-1 w-px', !props.isFirst && lineColor(props.future))} />
      <span
        class={cn(
          'size-[9px] shrink-0 rounded-full',
          props.future ? 'bg-edge' : 'bg-accent'
        )}
      />
      {/* Bottom connector: runs down to the next dot, coloured by that dot. */}
      <Show when={!props.isLast}>
        <span class={cn('w-px flex-1', lineColor(props.nextFuture))} />
      </Show>
    </div>
  );
}

/**
 * One timeline row: the {@link Rail} gutter plus a content column. Spacing
 * between items lives ONLY here, as bottom padding on the content column (omitted
 * on the last item). Because the flex row stretches the rail to match the padded
 * content height, the rail line extends through that padding down to the next dot.
 */
function TimeLineItem(props: {
  event: TimelineEvent;
  nextFuture?: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <li class="flex gap-3">
      <Rail
        future={props.event.future}
        nextFuture={props.nextFuture}
        isFirst={props.isFirst}
        isLast={props.isLast}
      />

      <div class={cn('flex min-w-0 flex-col', props.isLast ? '' : 'pb-4')}>
        <span class={cn('text-xxs', TEXT.tertiary)}>{props.event.time}</span>
        <span class={cn('text-sm font-medium', TEXT.primary)}>
          {props.event.title}
        </span>
        <Show when={props.event.description}>
          <span class={cn('text-xs', TEXT.secondary)}>
            {props.event.description}
          </span>
        </Show>

        {/* Real, clickable + hoverable entity mention — a compact ItemPreview
            (icon + resolved title + hover card). The rich `card` widget is too
            large for an inline timeline mention, so we render ItemPreview
            directly instead. */}
        <Show when={props.event.entity}>
          {(entity) => (
            <div class="mt-0.5 w-fit max-w-full">
              <ItemPreview
                id={entity().id}
                type={toItemType(entity().type) as ItemType}
                class="ring-0"
              />
            </div>
          )}
        </Show>
      </div>
    </li>
  );
}

/**
 * A vertical timeline of events. Each event sits on a left-hand rail; the rails
 * touch with zero gap so they form one continuous vertical line down the list.
 */
export function Timeline(props: TimelineProps) {
  const events = () => props.events;

  return (
    <div class="flex w-full flex-col gap-2">
      <Show when={props.title}>
        <span
          class={cn(
            'text-xxs font-medium uppercase tracking-wide',
            TEXT.tertiary
          )}
        >
          {props.title}
        </span>
      </Show>

      <Show
        when={events().length > 0}
        fallback={<span class={cn('text-xs', TEXT.secondary)}>No events.</span>}
      >
        <ol class="flex w-full flex-col gap-0">
          <For each={events()}>
            {(event, index) => (
              <TimeLineItem
                event={event}
                nextFuture={events()[index() + 1]?.future}
                isFirst={index() === 0}
                isLast={index() === events().length - 1}
              />
            )}
          </For>
        </ol>
      </Show>
    </div>
  );
}
