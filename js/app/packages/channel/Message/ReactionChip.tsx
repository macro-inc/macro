import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';

type ReactionChipProps = {
  emoji: string;
  count: number;
  selected?: boolean;
  interactive?: boolean;
  onClick?: (event: MouseEvent) => void;
};

export function ReactionChip(props: ReactionChipProps) {
  return (
    <button
      type="button"
      data-message-reaction-chip
      data-emoji={props.emoji}
      class={cn(
        'flex flex-row items-center gap-2 py-1 px-2 bg-menu border h-8',
        {
          'text-accent-ink border-accent': props.selected,
          'border-edge-muted hover:bg-hover hover:scale-105 transition-none hover:transition':
            !props.selected && props.interactive,
          'border-edge-muted': !props.selected && !props.interactive,
          'cursor-default': !props.interactive,
        }
      )}
      disabled={!props.interactive}
      onClick={(event) => props.onClick?.(event)}
    >
      <span class="text-md">{props.emoji}</span>
      <Show when={props.count > 1}>
        <span class="text-xs">{props.count}</span>
      </Show>
    </button>
  );
}
