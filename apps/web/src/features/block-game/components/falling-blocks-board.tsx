import { createMemo, For, Index } from 'solid-js';
import {
  BLOCKS_COLS,
  BLOCKS_ROWS,
  type FallingBlocksState,
  landingPiece,
  type PieceKind,
  pieceCells,
  previewCells,
} from '../core/games/falling-blocks';

const PIECE_TOKENS: Record<PieceKind, string> = {
  I: 'teal',
  O: 'amber',
  T: 'violet',
  S: 'green',
  Z: 'red',
  J: 'blue',
  L: 'orange',
};

function pieceColor(kind: PieceKind): string {
  return `var(--color-${PIECE_TOKENS[kind]})`;
}

type BoardCell = { kind: PieceKind | null; ghost: boolean };

export function FallingBlocksBoard(props: { state: FallingBlocksState }) {
  const cells = createMemo((): BoardCell[] => {
    const grid: BoardCell[] = props.state.board.map((kind) => ({
      kind,
      ghost: false,
    }));
    if (!props.state.over) {
      for (const [x, y] of pieceCells(landingPiece(props.state)))
        if (y >= 0 && !grid[y * BLOCKS_COLS + x].kind)
          grid[y * BLOCKS_COLS + x] = {
            kind: props.state.piece.kind,
            ghost: true,
          };
    }
    for (const [x, y] of pieceCells(props.state.piece))
      if (y >= 0)
        grid[y * BLOCKS_COLS + x] = {
          kind: props.state.piece.kind,
          ghost: false,
        };
    return grid;
  });
  const next = () => props.state.queue[0];

  return (
    <div class="flex w-full max-w-[26rem] items-start justify-center gap-3">
      <div
        class="grid w-full max-w-[17rem] gap-px rounded-xl border border-edge-muted bg-edge-muted p-px"
        style={{
          'grid-template-columns': `repeat(${BLOCKS_COLS}, minmax(0, 1fr))`,
          'aspect-ratio': `${BLOCKS_COLS} / ${BLOCKS_ROWS}`,
        }}
        role="img"
        aria-label={`Falling Blocks, ${props.state.score} points, level ${props.state.level}`}
      >
        <Index each={cells()}>
          {(cell) => (
            <span
              class="rounded-[3px]"
              style={{
                'background-color': cell().kind
                  ? pieceColor(cell().kind as PieceKind)
                  : 'var(--color-panel)',
                opacity: cell().ghost ? 0.28 : 1,
              }}
            />
          )}
        </Index>
      </div>
      <div class="flex w-20 shrink-0 flex-col gap-3 text-ink-subtle text-xs">
        <div class="flex flex-col gap-1.5">
          <span class="font-semibold uppercase tracking-wide">Next</span>
          <div class="relative size-16 rounded-lg border border-edge-muted bg-panel">
            <For each={next() ? previewCells(next()) : []}>
              {([x, y]) => (
                <span
                  class="absolute size-3.5 rounded-[3px]"
                  style={{
                    left: `${8 + x * 12}px`,
                    top: `${14 + y * 12}px`,
                    'background-color': pieceColor(next()),
                  }}
                />
              )}
            </For>
          </div>
        </div>
        <div class="flex flex-col">
          <span class="font-semibold uppercase tracking-wide">Lines</span>
          <span class="font-medium text-base text-ink tabular-nums">
            {props.state.lines}
          </span>
        </div>
        <div class="flex flex-col">
          <span class="font-semibold uppercase tracking-wide">Level</span>
          <span class="font-medium text-base text-ink tabular-nums">
            {props.state.level}
          </span>
        </div>
      </div>
    </div>
  );
}
