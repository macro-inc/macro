import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * The frame every agent card shares: a tile that says what the item is, its
 * name, and a line or two about it. The whole card opens the item - one
 * action, the obvious one - and settles in as it appears, so a card the
 * agent just produced reads as new without stealing the conversation.
 */
export function CardShell(props: {
  /** An icon or date tile, 40px square. */
  tile: JSX.Element;
  title: string;
  /** What the agent did to it: `Created`, `Sent`, `Scheduled`. */
  badge?: string;
  /** The line under the title. */
  meta?: JSX.Element;
  /** An optional third line, quieter still. */
  detail?: JSX.Element;
  /** Present when the item can be opened. */
  onOpen?: (event: MouseEvent) => void;
  /** The item is out of reach: no access, or gone. */
  muted?: boolean;
}) {
  return (
    <Dynamic
      component={props.onOpen ? 'button' : 'div'}
      type={props.onOpen ? 'button' : undefined}
      aria-label={props.onOpen ? `Open ${props.title}` : undefined}
      onClick={(event: MouseEvent) => props.onOpen?.(event)}
      data-agent-card
      class={cn(
        'group/card flex w-full max-w-md min-w-0 items-center gap-3 rounded-xl border border-edge-muted bg-panel px-3 py-2.5 text-left',
        'transition-[opacity,translate,background-color,border-color] duration-300 ease-out starting:translate-y-1 starting:opacity-0',
        props.onOpen && 'hover:border-edge hover:bg-hover',
        props.muted && 'opacity-70'
      )}
    >
      {props.tile}
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium text-ink">
            {props.title}
          </span>
          <Show when={props.badge}>
            {(badge) => (
              <span class="shrink-0 rounded-full bg-accent-bg px-1.5 text-[11px] leading-4 font-medium text-accent">
                {badge()}
              </span>
            )}
          </Show>
        </span>
        <Show when={props.meta}>
          <span class="truncate text-xs text-ink-muted">{props.meta}</span>
        </Show>
        <Show when={props.detail}>
          <span class="truncate text-xs text-ink-extra-muted">
            {props.detail}
          </span>
        </Show>
      </span>
      <Show when={props.onOpen}>
        <ArrowUpRight
          class="size-4 shrink-0 text-ink-extra-muted transition-colors group-hover/card:text-ink-muted"
          aria-hidden="true"
        />
      </Show>
    </Dynamic>
  );
}

/** A 40px tile behind an item's icon. */
export function IconTile(props: { children: JSX.Element }) {
  return (
    <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover">
      {props.children}
    </span>
  );
}
