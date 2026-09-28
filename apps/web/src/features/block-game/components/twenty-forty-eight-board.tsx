import { Key } from '@solid-primitives/keyed';
import { For } from 'solid-js';
import {
  TWENTY_FORTY_EIGHT_GOAL,
  type TwentyFortyEightState,
} from '../core/games/twenty-forty-eight';

/** Deeper accent for bigger tiles; the goal and beyond turn amber. */
function tileColors(value: number) {
  if (value >= TWENTY_FORTY_EIGHT_GOAL)
    return {
      background: 'var(--color-amber)',
      color: 'var(--color-accent-contrast)',
    };
  const strength = Math.min(90, 8 + Math.log2(value) * 8);
  return {
    background: `color-mix(in oklch, var(--color-accent) ${strength}%, var(--color-panel))`,
    color: strength > 50 ? 'var(--color-accent-contrast)' : 'var(--color-ink)',
  };
}

function tileTextSize(value: number): string {
  const digits = String(value).length;
  if (digits <= 2) return '2rem';
  if (digits === 3) return '1.6rem';
  if (digits === 4) return '1.25rem';
  return '1rem';
}

export function TwentyFortyEightBoard(props: { state: TwentyFortyEightState }) {
  const cells = () =>
    Array.from({ length: props.state.size * props.state.size });
  const span = () => 100 / props.state.size;

  return (
    <div
      class="relative aspect-square w-full max-w-[26rem] rounded-2xl border border-edge-muted bg-inset p-1.5"
      role="img"
      aria-label={`2048 board, highest tile ${Math.max(0, ...props.state.tiles.map((t) => t.value))}`}
    >
      <div class="relative size-full">
        <For each={cells()}>
          {(_, index) => (
            <span
              class="absolute p-1"
              style={{
                left: `${(index() % props.state.size) * span()}%`,
                top: `${Math.floor(index() / props.state.size) * span()}%`,
                width: `${span()}%`,
                height: `${span()}%`,
              }}
            >
              <span class="block size-full rounded-xl bg-hover" />
            </span>
          )}
        </For>
        {/* Keyed by id so each tile keeps its element and slides between cells. */}
        <Key each={props.state.tiles} by="id">
          {(tile) => (
            <span
              class="absolute p-1 transition-[left,top] duration-100 ease-out motion-reduce:transition-none"
              style={{
                left: `${tile().col * span()}%`,
                top: `${tile().row * span()}%`,
                width: `${span()}%`,
                height: `${span()}%`,
              }}
            >
              <span
                class="flex size-full items-center justify-center rounded-xl font-bold tabular-nums transition-transform duration-150 starting:scale-50 motion-reduce:transition-none"
                classList={{ 'scale-105': tile().merged === true }}
                style={{
                  'background-color': tileColors(tile().value).background,
                  color: tileColors(tile().value).color,
                  'font-size': tileTextSize(tile().value),
                }}
              >
                {tile().value}
              </span>
            </span>
          )}
        </Key>
      </div>
    </div>
  );
}
