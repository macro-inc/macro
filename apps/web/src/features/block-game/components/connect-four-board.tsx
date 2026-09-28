import { For } from 'solid-js';
import {
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  type ConnectFourCell,
  type ConnectFourState,
  connectFourDisc,
} from '../core/games/connect-four';
import { seatColor, seatTint } from './seat-color';

const columns = Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, c) => c);
// Rendered top to bottom; row 0 is the bottom of the board.
const rows = Array.from(
  { length: CONNECT_FOUR_ROWS },
  (_, r) => CONNECT_FOUR_ROWS - 1 - r
);

export function ConnectFourBoard(props: {
  state: ConnectFourState;
  winningCells: ConnectFourCell[] | undefined;
  canMove: boolean;
  /** The seat about to move, previewed on hover. */
  previewSeat: number | undefined;
  onDrop: (column: number) => void;
}) {
  const winning = (column: number, row: number) =>
    props.winningCells?.some(([c, r]) => c === column && r === row) ?? false;

  return (
    <div
      class="flex w-full max-w-[26rem] gap-1.5 rounded-3xl border border-edge-muted bg-panel p-2.5"
      role="grid"
      aria-label="Connect Four board"
    >
      <For each={columns}>
        {(column) => {
          const full = () =>
            props.state.columns[column].length >= CONNECT_FOUR_ROWS;
          return (
            <button
              type="button"
              class="group flex flex-1 flex-col gap-1.5 rounded-2xl p-0.5 transition-colors enabled:hover:bg-hover disabled:cursor-default"
              disabled={!props.canMove || full()}
              aria-label={`Drop a disc in column ${column + 1}`}
              onClick={() => props.onDrop(column)}
            >
              <For each={rows}>
                {(row) => {
                  const seat = () => connectFourDisc(props.state, column, row);
                  const isNextSlot = () =>
                    row === props.state.columns[column].length;
                  return (
                    <span
                      class="block aspect-square w-full rounded-full border-2 transition-colors group-hover:data-preview:bg-(--preview)"
                      classList={{
                        'border-edge-muted bg-page': seat() === undefined,
                      }}
                      style={
                        seat() !== undefined
                          ? {
                              'background-color': seatColor(seat() as number),
                              'border-color': winning(column, row)
                                ? 'var(--color-ink)'
                                : seatColor(seat() as number),
                            }
                          : props.canMove &&
                              isNextSlot() &&
                              props.previewSeat !== undefined
                            ? {
                                '--preview': seatTint(props.previewSeat, 35),
                              }
                            : undefined
                      }
                      data-preview={
                        seat() === undefined &&
                        props.canMove &&
                        isNextSlot() &&
                        props.previewSeat !== undefined
                          ? ''
                          : undefined
                      }
                    />
                  );
                }}
              </For>
            </button>
          );
        }}
      </For>
    </div>
  );
}
