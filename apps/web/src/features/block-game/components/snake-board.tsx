import { Index, Show } from 'solid-js';
import type { SnakeState } from '../core/games/snake';

export function SnakeBoard(props: { state: SnakeState }) {
  const cell = () => 100 / props.state.size;
  const at = (x: number, y: number) => ({
    left: `${x * cell()}%`,
    top: `${y * cell()}%`,
    width: `${cell()}%`,
    height: `${cell()}%`,
  });

  return (
    <div
      class="relative aspect-square w-full max-w-[26rem] overflow-hidden rounded-2xl border border-edge-muted bg-panel"
      style={{
        'background-image':
          'repeating-conic-gradient(var(--color-hover) 0 25%, transparent 0 50%)',
        'background-size': `${cell() * 2}% ${cell() * 2}%`,
      }}
      role="img"
      aria-label={`Snake board, ${props.state.score} points`}
    >
      <Show when={props.state.apple}>
        {(apple) => (
          <span
            class="absolute scale-75 rounded-full bg-red"
            style={at(apple().x, apple().y)}
          />
        )}
      </Show>
      <Index each={props.state.body}>
        {(point, index) => (
          <span
            class="absolute scale-90 rounded-[30%]"
            style={{
              ...at(point().x, point().y),
              'background-color':
                index === 0
                  ? 'var(--color-accent)'
                  : 'color-mix(in oklch, var(--color-accent) 65%, transparent)',
            }}
          />
        )}
      </Index>
    </div>
  );
}
