import { describe, expect, it } from 'vitest';
import type { TurnRules } from '../turn-match';
import {
  CONNECT_FOUR_ROWS,
  connectFourRules,
  connectFourWinningCells,
} from './connect-four';
import { dotsAndBoxesRules, dotsScores } from './dots-and-boxes';
import { ticTacToeRules } from './tic-tac-toe';

/** Apply moves in order, each by whichever seat is to move. */
function play<State, Move>(
  rules: TurnRules<State, Move>,
  players: number,
  moves: Move[],
  round = 0
): State {
  let state = rules.initial(players, round);
  for (const move of moves) {
    const progress = rules.progress(state);
    if (progress.t !== 'turn') throw new Error('game already over');
    const next = rules.apply(state, move, progress.seat);
    if (!next) throw new Error(`illegal move ${JSON.stringify(move)}`);
    state = next;
  }
  return state;
}

describe('tic-tac-toe', () => {
  it('detects a diagonal win', () => {
    const state = play(ticTacToeRules, 2, [
      { cell: 0 },
      { cell: 1 },
      { cell: 4 },
      { cell: 2 },
      { cell: 8 },
    ]);
    expect(ticTacToeRules.progress(state)).toEqual({
      t: 'over',
      winners: [0],
    });
  });

  it('declares a full board without a line a draw', () => {
    const state = play(
      ticTacToeRules,
      2,
      [0, 1, 2, 4, 3, 5, 7, 6, 8].map((cell) => ({ cell }))
    );
    expect(ticTacToeRules.progress(state)).toEqual({ t: 'over', winners: [] });
  });

  it('rejects malformed moves', () => {
    expect(ticTacToeRules.parseMove({ cell: 9 })).toBeUndefined();
    expect(ticTacToeRules.parseMove({ cell: 1.5 })).toBeUndefined();
    expect(ticTacToeRules.parseMove('0')).toBeUndefined();
  });
});

describe('connect four', () => {
  it('finds vertical, horizontal and diagonal lines', () => {
    const vertical = play(
      connectFourRules,
      2,
      [0, 1, 0, 1, 0, 1, 0].map((column) => ({ column }))
    );
    expect(connectFourRules.progress(vertical)).toEqual({
      t: 'over',
      winners: [0],
    });

    const horizontal = play(
      connectFourRules,
      2,
      [0, 0, 1, 1, 2, 2, 3].map((column) => ({ column }))
    );
    expect(connectFourWinningCells(horizontal)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);

    // Seat 1 builds a rising diagonal from (0, 0) to (3, 3).
    const diagonal = play(
      connectFourRules,
      2,
      [1, 0, 2, 1, 2, 2, 3, 3, 3, 3].map((column) => ({ column }))
    );
    expect(connectFourRules.progress(diagonal)).toEqual({
      t: 'over',
      winners: [1],
    });
    expect(connectFourWinningCells(diagonal)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('refuses a full column', () => {
    const full = play(
      connectFourRules,
      2,
      Array.from({ length: CONNECT_FOUR_ROWS }, () => ({ column: 2 }))
    );
    expect(connectFourRules.apply(full, { column: 2 }, 0)).toBeUndefined();
  });
});

describe('dots and boxes', () => {
  it('claims a closed box and grants another turn', () => {
    // Close the top-left box of a 4×4 board: top, left, right, then bottom.
    let state = dotsAndBoxesRules.initial(2, 0);
    state = dotsAndBoxesRules.apply(state, { edge: 'h', index: 0 }, 0)!;
    state = dotsAndBoxesRules.apply(state, { edge: 'v', index: 0 }, 1)!;
    state = dotsAndBoxesRules.apply(state, { edge: 'v', index: 1 }, 0)!;
    expect(state.turn).toBe(1);
    state = dotsAndBoxesRules.apply(state, { edge: 'h', index: 4 }, 1)!;
    expect(state.boxes[0]).toBe(1);
    expect(state.turn).toBe(1);
    expect(dotsScores(state)).toEqual([0, 1]);
  });

  it('rejects drawn and out-of-range edges', () => {
    const state = dotsAndBoxesRules.apply(
      dotsAndBoxesRules.initial(2, 0),
      { edge: 'h', index: 0 },
      0
    )!;
    expect(
      dotsAndBoxesRules.apply(state, { edge: 'h', index: 0 }, 1)
    ).toBeUndefined();
    expect(
      dotsAndBoxesRules.apply(state, { edge: 'v', index: 20 }, 1)
    ).toBeUndefined();
  });

  it('ends when every box is claimed', () => {
    let state = dotsAndBoxesRules.initial(2, 0);
    const edges = [
      ...state.horizontal.map((_, index) => ({ edge: 'h' as const, index })),
      ...state.vertical.map((_, index) => ({ edge: 'v' as const, index })),
    ];
    for (const edge of edges) {
      const progress = dotsAndBoxesRules.progress(state);
      if (progress.t !== 'turn') break;
      state = dotsAndBoxesRules.apply(state, edge, progress.seat)!;
    }
    const progress = dotsAndBoxesRules.progress(state);
    expect(progress.t).toBe('over');
    expect(dotsScores(state).reduce((a, b) => a + b, 0)).toBe(16);
  });
});
