import ArrowDown from '@phosphor-icons/core/regular/arrow-down.svg?component-solid';
import ArrowUp from '@phosphor-icons/core/regular/arrow-up.svg?component-solid';
import { cn, Layer } from '@ui';
import { Show } from 'solid-js';

export function UnreadNotificationsOverlay(props: {
  direction: 'above' | 'below';
  count: number;
  onClick: () => void;
  bottomInset?: number;
}) {
  return (
    <Show when={props.count > 0}>
      <Layer depth={3}>
        <button
          type="button"
          aria-label={`${props.count} unread notification ${props.count === 1 ? 'stack' : 'stacks'} ${props.direction}`}
          class={cn(
            'absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs bg-surface border border-edge-muted shadow-lg not-touch:hover:overlay-hover not-touch:active:overlay-active',
            props.direction === 'above'
              ? 'top-4 touch:top-[calc(var(--mobile-content-inset-top,0)+1rem)]'
              : 'bottom-4'
          )}
          style={
            props.direction === 'below'
              ? { bottom: `${(props.bottomInset ?? 0) + 16}px` }
              : undefined
          }
          onClick={props.onClick}
        >
          <Show
            when={props.direction === 'above'}
            fallback={<ArrowDown class="size-3.5" aria-hidden="true" />}
          >
            <ArrowUp class="size-3.5" aria-hidden="true" />
          </Show>
          Unread notification
          <span class="rounded-full bg-ink/10 px-1.5 tabular-nums">
            {props.count}
          </span>
        </button>
      </Layer>
    </Show>
  );
}
