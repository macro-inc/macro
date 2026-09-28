import { For } from 'solid-js';
import { seatColor, seatTint } from './seat-color';

export const TIC_TAC_TOE_MARKS = ['✕', '◯'] as const;

export function TicTacToeBoard(props: {
  board: readonly (number | null)[];
  winningLine: readonly number[] | undefined;
  canMove: boolean;
  onMove: (cell: number) => void;
}) {
  return (
    <div
      class="grid aspect-square w-full max-w-80 grid-cols-3 gap-2"
      role="grid"
      aria-label="Tic-tac-toe board"
    >
      <For each={props.board}>
        {(mark, index) => (
          <button
            type="button"
            class="flex aspect-square items-center justify-center rounded-2xl border border-edge-muted bg-panel font-semibold text-5xl transition-colors enabled:hover:bg-hover disabled:cursor-default"
            disabled={!props.canMove || mark !== null}
            aria-label={`Row ${Math.floor(index() / 3) + 1}, column ${(index() % 3) + 1}${
              mark === null ? '' : `, ${mark === 0 ? 'X' : 'O'}`
            }`}
            style={{
              color: mark === null ? undefined : seatColor(mark),
              'background-color':
                mark !== null && props.winningLine?.includes(index())
                  ? seatTint(mark, 18)
                  : undefined,
            }}
            onClick={() => props.onMove(index())}
          >
            {mark === null ? '' : TIC_TAC_TOE_MARKS[mark]}
          </button>
        )}
      </For>
    </div>
  );
}
