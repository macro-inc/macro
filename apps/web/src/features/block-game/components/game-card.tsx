import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { GameDefinition, GameKind } from '../core/catalog';

function gameEmoji(kind: GameKind): string {
  return match(kind)
    .with('pong', () => '🏓')
    .with('brick_breaker', () => '🧱')
    .with('snake', () => '🐍')
    .with('falling_blocks', () => '🟦')
    .with('invaders', () => '👾')
    .with('flappy', () => '🐤')
    .with('twenty_forty_eight', () => '🔢')
    .with('minesweeper', () => '💣')
    .with('tic_tac_toe', () => '⭕')
    .with('connect_four', () => '🔴')
    .with('dots_and_boxes', () => '🔲')
    .with('typing_race', () => '⌨️')
    .exhaustive();
}

function playersLabel(definition: GameDefinition): string {
  const { min, max } = definition.players;
  if (max === 1) return 'Solo';
  if (min === max) return `${max} players`;
  return `${min}–${max} players`;
}

/** One game in the hub: what it is, the team record, and a way to play. */
export function GameCard(props: {
  definition: GameDefinition;
  record: JSX.Element;
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <article class="flex flex-col gap-3 rounded-2xl border border-edge-muted bg-panel p-4">
      <div class="flex items-start gap-3">
        <span aria-hidden="true" class="text-3xl leading-none">
          {gameEmoji(props.definition.kind)}
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 class="font-semibold text-ink">{props.definition.title}</h3>
          <p class="text-ink-muted text-sm">{props.definition.tagline}</p>
        </div>
      </div>
      <div class="flex items-center gap-2 text-ink-subtle text-xs">
        <span class="rounded-full border border-edge-muted px-2 py-0.5">
          {playersLabel(props.definition)}
        </span>
        <span class="min-w-0 truncate">{props.record}</span>
      </div>
      <Button
        variant="accent"
        size="sm"
        class="self-start"
        disabled={props.creating}
        onClick={props.onCreate}
      >
        <Show when={props.creating} fallback="New game">
          Creating…
        </Show>
      </Button>
    </article>
  );
}
