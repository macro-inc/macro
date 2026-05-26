import { touchHandler } from '@core/directive/touchHandler';
import { idToDisplayName } from '@core/user';
import { Popover } from '@kobalte/core/popover';
import { Button, cn, HoverCard } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

type ReactionChipProps = {
  emoji: string;
  count: number;
  users: string[];
  currentUserId: string | undefined;
  selected?: boolean;
  interactive?: boolean;
  onClick?: (event: MouseEvent) => void;
};

/**
 * Format a list of user display names with Oxford comma style.
 * Current user ("You") is always listed first regardless of input order.
 * e.g. "You", "You and Alice", "You, Alice, and Bob"
 */
export function formatReactorNames(
  userIds: string[],
  currentUserId: string | undefined
): string {
  if (userIds.length === 0) return '';

  const ordered = [
    ...userIds.filter((id) => id === currentUserId),
    ...userIds.filter((id) => id !== currentUserId),
  ];

  const names = ordered.map((id) =>
    id === currentUserId ? 'You' : idToDisplayName(id)
  );

  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;

  const allButLast = names.slice(0, -1);
  const last = names[names.length - 1];
  return `${allButLast.join(', ')}, and ${last}`;
}

function ReactionTooltipContent(props: {
  users: string[];
  currentUserId: string | undefined;
  emoji: string;
}): JSX.Element {
  return (
    <span>
      {formatReactorNames(props.users, props.currentUserId)} reacted with{' '}
      <span class="text-md">{props.emoji}</span>
    </span>
  );
}

export function ReactionChip(props: ReactionChipProps) {
  const [showReactors, setShowReactors] = createSignal(false);

  return (
    <Popover
      open={showReactors()}
      onOpenChange={setShowReactors}
      placement="top"
    >
      <Popover.Anchor>
        <HoverCard
          placement="top"
          content={
            <ReactionTooltipContent
              users={props.users}
              currentUserId={props.currentUserId}
              emoji={props.emoji}
            />
          }
        >
          <Button
            data-message-reaction-chip
            data-emoji={props.emoji}
            noTouchResize
            ref={(el) =>
              touchHandler(el, () => ({
                onLongPress: () => {
                  setShowReactors(true);
                },
                stopTouchStartPropagation: true,
              }))
            }
            size="sm"
            variant="base"
            class={cn(
              'flex flex-row items-center h-7 min-w-7 gap-2 rounded-sm',
              {
                'border-edge-muted hover:bg-hover hover:scale-105':
                  props.interactive,
                'border-edge-muted': !props.selected && !props.interactive,
                'text-accent border-accent hover:bg-accent-hover':
                  props.selected,
                'pointer-events-auto': !props.interactive,
              }
            )}
            disabled={!props.interactive}
            onClick={(event) => {
              event.stopPropagation();
              props.onClick?.(event);
            }}
          >
            <span class="text-lg leading-0">{props.emoji}</span>
            <Show when={props.count > 1}>
              <span class="text-xs">{props.count}</span>
            </Show>
          </Button>
        </HoverCard>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content class="z-modal bg-surface p-1.5 text-ink-muted text-xs rounded-sm ring-1 ring-edge-muted">
          <ReactionTooltipContent
            users={props.users}
            currentUserId={props.currentUserId}
            emoji={props.emoji}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
