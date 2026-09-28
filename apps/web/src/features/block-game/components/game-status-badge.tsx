import { match } from 'ts-pattern';
import type { GameCategory } from '../core/catalog';
import type { GameStatus } from '../core/status';

/** Labels for a known game; outside the room the game may be unknown. */
function gameStatusLabel(
  status: GameStatus,
  category: GameCategory | undefined
): string {
  return match(status)
    .with('waiting', () =>
      category === 'solo'
        ? 'Ready to play'
        : category
          ? 'Waiting for players'
          : 'Not started'
    )
    .with('in_progress', () =>
      category === 'solo' ? 'Playing now' : 'In progress'
    )
    .with('finished', () => 'Finished')
    .exhaustive();
}

export function GameStatusBadge(props: {
  status: GameStatus;
  category?: GameCategory;
}) {
  return (
    <span
      class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-edge-muted px-2.5 font-medium text-ink-muted text-xs"
      data-game-status={props.status}
    >
      <span
        aria-hidden="true"
        class="size-2 rounded-full"
        classList={{
          'bg-ink-disabled': props.status === 'waiting',
          'bg-warning': props.status === 'in_progress',
          'bg-success': props.status === 'finished',
        }}
      />
      {gameStatusLabel(props.status, props.category)}
    </span>
  );
}
