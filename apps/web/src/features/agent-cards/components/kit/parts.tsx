import { Card, cn, Item } from '@ui';
import type { ParentProps } from 'solid-js';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * A calendar page as an item's media: the month over the day of the month,
 * both quieter for a day that has passed.
 */
export function DateTile(props: { date: Date; past?: boolean }) {
  return (
    <Item.Media
      class={cn(
        'flex-col gap-0 self-center',
        props.past ? 'text-ink-disabled' : 'text-ink'
      )}
      aria-hidden="true"
    >
      <span
        class={cn(
          'text-[9px] leading-[10px] font-semibold tracking-wider uppercase',
          props.past ? 'text-ink-disabled' : 'text-ink-subtle'
        )}
      >
        {MONTHS[props.date.getMonth()]}
      </span>
      <span class="text-[15px] leading-[18px] font-semibold tabular-nums">
        {props.date.getDate()}
      </span>
    </Item.Media>
  );
}

/**
 * One row of a list inside a card, a small `Item`. Rows count toward what a
 * fixed card says it is hiding.
 */
export function CardRow(
  props: ParentProps<{
    /** Align to the top, for rows that wrap or carry a second line. */
    top?: boolean;
    onClick?: (event: MouseEvent) => void;
    class?: string;
  }>
) {
  return (
    <Item
      size="sm"
      data-card-row
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onClick={(event: MouseEvent) => props.onClick?.(event)}
      onKeyDown={(event: KeyboardEvent) => {
        if (props.onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          props.onClick(event as unknown as MouseEvent);
        }
      }}
      class={cn(
        'gap-2.5 rounded-lg',
        props.top ? 'items-start' : 'items-center',
        props.onClick && 'not-touch:hover:bg-hover touch:min-h-[44px]',
        props.class
      )}
    >
      {props.children}
    </Item>
  );
}

/** The small-caps header of a group of rows: a day, a kind of item. */
export function CardGroupHeader(props: ParentProps) {
  return (
    <Card.Metadata class="px-2 pt-2 pb-0.5 font-semibold tracking-wide uppercase">
      {props.children}
    </Card.Metadata>
  );
}

/** A placeholder bar while a card's content loads. */
export function Skeleton(props: { width: string; height?: string }) {
  return (
    <span
      class="skeleton-shimmer block rounded bg-skeleton"
      style={{ width: props.width, height: props.height ?? '10px' }}
    />
  );
}

/** A card's placeholder while its item loads: its media and two bars. */
export function SkeletonSingle() {
  return (
    <Card.Header class="flex-1 justify-center" aria-busy="true">
      <Item class="gap-3 border-0 p-0">
        <Item.Media class="skeleton-shimmer self-center bg-skeleton" />
        <Item.Content class="gap-2">
          <Skeleton width="62%" />
          <Skeleton width="38%" height="8px" />
        </Item.Content>
      </Item>
    </Card.Header>
  );
}
