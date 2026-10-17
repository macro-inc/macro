import { cn } from '@ui';
import type { JSX, ParentProps } from 'solid-js';
import { Show } from 'solid-js';

/** How a tile, badge or pill reads: neutral, the accent, or a status. */
export type CardTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

const TILE_TONES: Record<CardTone | 'frame', string> = {
  neutral: 'bg-hover text-ink-muted',
  accent: 'bg-accent-bg text-accent',
  ok: 'bg-success-bg text-success-ink',
  warn: 'bg-warning-bg text-warning-ink',
  bad: 'bg-failure-bg text-failure',
  frame: 'border border-edge-muted bg-panel text-ink-muted',
};

const TILE_SIZES = {
  40: 'size-10 rounded-lg [&>svg:not([class*=size-])]:size-[18px]',
  32: 'size-8 rounded-lg [&>svg:not([class*=size-])]:size-4',
  24: 'size-6 rounded-md [&>svg:not([class*=size-])]:size-3.5',
};

/**
 * The square at the head of a card that says what it is: 40px behind an
 * item's icon, 32px in the accent for an ask, 24px inside rows.
 */
export function Tile(
  props: ParentProps<{
    size?: 40 | 32 | 24;
    tone?: CardTone | 'frame';
    class?: string;
  }>
) {
  return (
    <span
      class={cn(
        'flex flex-none items-center justify-center',
        TILE_SIZES[props.size ?? 40],
        TILE_TONES[props.tone ?? 'neutral'],
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

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
 * A calendar tile: the month in the accent over the day of the month, the
 * month quieter for a day that has passed.
 */
export function DateTile(props: {
  date: Date;
  size?: 40 | 32;
  past?: boolean;
}) {
  return (
    <span
      class={cn(
        'flex flex-none flex-col items-center justify-center rounded-lg border border-edge-muted bg-panel',
        props.size === 32 ? 'size-8' : 'size-10'
      )}
      aria-hidden="true"
    >
      <span
        class={cn(
          'text-[9px] leading-[10px] font-semibold tracking-wider uppercase',
          props.past ? 'text-ink-disabled' : 'text-accent'
        )}
      >
        {MONTHS[props.date.getMonth()]}
      </span>
      <span
        class={cn(
          'font-semibold tabular-nums',
          props.size === 32
            ? 'text-[13px] leading-4'
            : 'text-[15px] leading-[18px]'
        )}
      >
        {props.date.getDate()}
      </span>
    </span>
  );
}

const BADGE_TONES: Record<CardTone, string> = {
  neutral: 'bg-active text-ink-muted',
  accent: 'bg-accent-bg text-accent',
  ok: 'bg-success-bg text-success-ink',
  warn: 'bg-warning-bg text-warning-ink',
  bad: 'bg-failure-bg text-failure-ink',
};

/** What happened to an item, next to its title: `Created`, `Sent`. */
export function CardBadge(
  props: ParentProps<{ tone?: CardTone; class?: string }>
) {
  return (
    <span
      class={cn(
        'inline-flex h-4 flex-none items-center gap-1 rounded-full px-1.5 text-[11px] leading-4 font-medium whitespace-nowrap [&>svg]:size-2.5',
        BADGE_TONES[props.tone ?? 'accent'],
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

/** A state or a risk, squarer than a badge: `In progress`, `External`. */
export function CardPill(
  props: ParentProps<{ tone?: CardTone; class?: string }>
) {
  return (
    <span
      class={cn(
        'inline-flex h-5 flex-none items-center gap-1.5 rounded-md px-2 text-[11px] leading-5 font-medium whitespace-nowrap [&>svg]:size-3',
        BADGE_TONES[props.tone ?? 'neutral'],
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

/**
 * A recessed area inside a card for anything code-like or quoted: an
 * action's inputs, a field and its value.
 */
export function Well(
  props: ParentProps<{ label?: JSX.Element; flush?: boolean; class?: string }>
) {
  return (
    <div
      class={cn(
        'min-w-0 rounded-lg bg-surface',
        props.flush ? 'overflow-hidden p-0' : 'px-3 py-2.5',
        props.class
      )}
    >
      <Show when={props.label}>
        <div class="text-xs font-medium text-ink-muted">{props.label}</div>
      </Show>
      {props.children}
    </div>
  );
}

/** Preformatted text in a well, wrapped rather than scrolled sideways. */
export function WellText(props: ParentProps<{ class?: string }>) {
  return (
    <pre
      class={cn(
        'm-0 font-mono text-xs leading-[18px] whitespace-pre-wrap text-ink-muted [overflow-wrap:anywhere]',
        props.class
      )}
    >
      {props.children}
    </pre>
  );
}

/**
 * One row of a list inside a card. Rows count toward what a fixed card says
 * it is hiding.
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
    <div
      data-card-row
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      onClick={(event) => props.onClick?.(event)}
      onKeyDown={(event) => {
        if (props.onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          props.onClick(event as unknown as MouseEvent);
        }
      }}
      class={cn(
        'flex min-w-0 gap-2.5 rounded-lg p-1.5',
        props.top ? 'items-start' : 'items-center',
        props.onClick && 'not-touch:hover:bg-hover',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

/** The small-caps header of a group of rows: a day, a kind of item. */
export function CardGroupHeader(props: ParentProps) {
  return (
    <div class="px-1.5 pt-2 pb-0.5 text-[11px] leading-4 font-semibold tracking-wide text-ink-subtle uppercase">
      {props.children}
    </div>
  );
}

/** A placeholder bar while a card's content loads. */
export function Skeleton(props: { width: string; height?: string }) {
  return (
    <span
      class="block animate-pulse rounded bg-active"
      style={{ width: props.width, height: props.height ?? '10px' }}
    />
  );
}

/** A card's placeholder while its item loads: a tile and two bars. */
export function SkeletonSingle() {
  return (
    <div class="flex items-center gap-3 px-3 py-2.5" aria-busy="true">
      <span class="size-10 flex-none animate-pulse rounded-lg bg-hover" />
      <span class="flex flex-1 flex-col gap-2">
        <Skeleton width="62%" />
        <Skeleton width="38%" height="8px" />
      </span>
    </div>
  );
}
