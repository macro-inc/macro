import { type ChannelEntity, Entity } from '@entity';
import { cn } from '@ui';
import type { ParentProps } from 'solid-js';
import { Show } from 'solid-js';

/** How many favorites the mobile Channels list pins above its conversations. */
export const MAX_PINNED_CHANNELS = 6;

/**
 * Pinned conversations three across, like iMessage: a short last row
 * centers rather than hugging the left edge. Each child takes a third.
 */
export function ChannelPinGrid(props: ParentProps) {
  return (
    <div
      role="group"
      aria-label="Pinned conversations"
      class="flex flex-wrap justify-center gap-y-4 px-(--mobile-chrome-gutter) pt-2 pb-5"
    >
      {props.children}
    </div>
  );
}

export function ChannelPin(props: {
  channel: ChannelEntity;
  unread: boolean;
  onActivate: (event: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      class="flex w-full min-w-0 flex-col items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onClick={(event) => props.onActivate(event)}
    >
      <span class="relative size-22 shrink-0">
        <span class="grid size-full place-items-center overflow-hidden rounded-full bg-surface-2 text-ink-muted [&_img]:size-full [&_img]:object-cover [&_svg]:size-9">
          <Entity.Icon
            entity={props.channel}
            suppressClick
            showTooltip={false}
          />
        </span>
        <Show when={props.unread}>
          <span
            aria-label="Unread"
            class="absolute top-1 left-1 size-3.5 rounded-full border-2 border-panel bg-accent"
          />
        </Show>
      </span>
      <span
        class={cn(
          'max-w-full truncate px-1 text-xs',
          props.unread ? 'text-ink' : 'text-ink-muted'
        )}
      >
        {props.channel.name}
      </span>
    </button>
  );
}
