import { Tooltip } from '@core/component/Tooltip';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user';
import { cn } from '@ui/utils/classname';
import { createMemo, Show } from 'solid-js';

type ReactionChipProps = {
  emoji: string;
  count: number;
  users: string[];
  selected?: boolean;
  interactive?: boolean;
  onClick?: (event: MouseEvent) => void;
};

/**
 * Format a list of user display names with Oxford comma style.
 * e.g. "You", "You and Alice", "You, Alice, and Bob"
 */
export function formatReactorNames(
  userIds: string[],
  currentUserId: string | undefined
): string {
  const names = userIds.map((id) => {
    if (id === currentUserId) return 'You';
    return idToDisplayName(id);
  });

  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;

  const allButLast = names.slice(0, -1);
  const last = names[names.length - 1];
  return `${allButLast.join(', ')}, and ${last}`;
}

export function ReactionChip(props: ReactionChipProps) {
  const userId = useUserId();

  const tooltipContent = createMemo(() => (
    <span>
      {formatReactorNames(props.users, userId() ?? undefined)} reacted with{' '}
      <span class="text-md">{props.emoji}</span>
    </span>
  ));

  return (
    <Tooltip tooltip={tooltipContent()} placement="top">
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
    </Tooltip>
  );
}
