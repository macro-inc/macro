import { For, Match, onCleanup, Switch } from 'solid-js';
import type { MinesweeperState } from '../core/games/minesweeper';

const LONG_PRESS_MS = 400;

/** The classic palette, drawn from theme tokens. */
function adjacentColor(count: number): string {
  const tokens = ['blue', 'green', 'red', 'violet', 'orange', 'teal'];
  return count <= tokens.length
    ? `var(--color-${tokens[count - 1]})`
    : 'var(--color-ink)';
}

export function MinesweeperBoard(props: {
  state: MinesweeperState;
  /** Taps place flags instead of revealing cells. */
  flagMode: boolean;
  disabled: boolean;
  onReveal: (index: number) => void;
  onFlag: (index: number) => void;
  onChord: (index: number) => void;
}) {
  const over = () =>
    props.state.status === 'won' || props.state.status === 'lost';
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  onCleanup(() => clearTimeout(pressTimer));

  const activate = (index: number) => {
    if (longPressed) {
      longPressed = false;
      return;
    }
    const cell = props.state.cells[index];
    if (cell.revealed) props.onChord(index);
    else if (props.flagMode) props.onFlag(index);
    else props.onReveal(index);
  };

  return (
    <div
      class="grid w-full max-w-[28rem] gap-0.5 rounded-2xl border border-edge-muted bg-inset p-1.5"
      style={{
        'grid-template-columns': `repeat(${props.state.cols}, minmax(0, 1fr))`,
      }}
      role="grid"
      aria-label="Minefield"
    >
      <For each={props.state.cells}>
        {(cell, index) => (
          <button
            type="button"
            class="flex aspect-square items-center justify-center rounded-md font-bold text-sm tabular-nums disabled:cursor-default"
            classList={{
              'bg-control enabled:hover:bg-hover': !cell.revealed,
              'bg-page': cell.revealed && !cell.mine,
              'bg-red-bg': cell.revealed && cell.mine,
            }}
            style={{
              color:
                cell.revealed && !cell.mine && cell.adjacent > 0
                  ? adjacentColor(cell.adjacent)
                  : undefined,
              outline:
                props.state.exploded === index()
                  ? '2px solid var(--color-red)'
                  : undefined,
            }}
            disabled={
              props.disabled || over() || (cell.revealed && cell.adjacent === 0)
            }
            aria-label={
              cell.flagged
                ? 'Flagged'
                : cell.revealed
                  ? cell.mine
                    ? 'Mine'
                    : cell.adjacent > 0
                      ? `${cell.adjacent} neighboring mines`
                      : 'Empty'
                  : 'Hidden'
            }
            onClick={() => activate(index())}
            onContextMenu={(event) => {
              event.preventDefault();
              // Android follows a long press with contextmenu; it already flagged.
              if (longPressed) return;
              if (!props.disabled && !over()) props.onFlag(index());
            }}
            onPointerDown={(event) => {
              longPressed = false;
              clearTimeout(pressTimer);
              if (
                event.pointerType !== 'touch' ||
                cell.revealed ||
                props.disabled ||
                over()
              )
                return;
              pressTimer = setTimeout(() => {
                longPressed = true;
                props.onFlag(index());
              }, LONG_PRESS_MS);
            }}
            onPointerUp={() => clearTimeout(pressTimer)}
            onPointerLeave={() => clearTimeout(pressTimer)}
          >
            <Switch>
              <Match when={cell.flagged && over() && !cell.mine}>
                <span class="text-red">✕</span>
              </Match>
              <Match when={cell.flagged}>🚩</Match>
              <Match when={cell.revealed && cell.mine}>✹</Match>
              <Match when={cell.revealed && cell.adjacent > 0}>
                {cell.adjacent}
              </Match>
            </Switch>
          </button>
        )}
      </For>
    </div>
  );
}
