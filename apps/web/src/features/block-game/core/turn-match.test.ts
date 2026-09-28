import { describe, expect, it } from 'vitest';
import type { GameLogEntry } from './game-log';
import { connectFourRules } from './games/connect-four';
import { dotsAndBoxesRules } from './games/dots-and-boxes';
import { ticTacToeRules } from './games/tic-tac-toe';
import { replayTurnMatch, seriesWins } from './turn-match';

const join = (by: string): GameLogEntry => ({ t: 'join', by });
const move = (by: string, cell: number): GameLogEntry => ({
  t: 'move',
  by,
  move: { cell },
});

describe('replayTurnMatch', () => {
  it('seats players in join order and starts a full two-seat table', () => {
    const match = replayTurnMatch(ticTacToeRules, [
      join('ann'),
      join('ann'),
      join('bob'),
      join('cat'),
    ]);
    expect(match.seats).toEqual(['ann', 'bob']);
    expect(match.phase).toMatchObject({ t: 'playing', round: 0, turn: 0 });
  });

  it('ignores moves out of turn, by spectators, and onto taken cells', () => {
    const match = replayTurnMatch(ticTacToeRules, [
      join('ann'),
      join('bob'),
      move('bob', 0),
      move('cat', 0),
      move('ann', 4),
      move('bob', 4),
      move('bob', 1),
    ]);
    expect(match.phase.t).toBe('playing');
    if (match.phase.t !== 'playing') return;
    expect(match.phase.state.board).toEqual([
      null,
      1,
      null,
      null,
      0,
      null,
      null,
      null,
      null,
    ]);
    expect(match.phase.turn).toBe(0);
  });

  it('keeps only the first of two concurrent moves for the same turn', () => {
    const match = replayTurnMatch(connectFourRules, [
      join('ann'),
      join('bob'),
      { t: 'move', by: 'ann', move: { column: 3 } },
      { t: 'move', by: 'ann', move: { column: 4 } },
    ]);
    if (match.phase.t !== 'playing') throw new Error('expected play');
    expect(match.phase.state.columns[3]).toEqual([0]);
    expect(match.phase.state.columns[4]).toEqual([]);
    expect(match.phase.turn).toBe(1);
  });

  it('records wins, rotates the opener on rematch, and counts the series', () => {
    const log: GameLogEntry[] = [
      join('ann'),
      join('bob'),
      move('ann', 0),
      move('bob', 3),
      move('ann', 1),
      move('bob', 4),
      move('ann', 2),
      { t: 'rematch', by: 'bob' },
    ];
    const match = replayTurnMatch(ticTacToeRules, log);
    expect(match.results).toEqual([
      { round: 0, players: ['ann', 'bob'], winners: ['ann'] },
    ]);
    expect(match.phase).toMatchObject({ t: 'playing', round: 1, turn: 1 });
    expect(seriesWins(match.results).get('ann')).toBe(1);
  });

  it('awards a forfeit to the opponent', () => {
    const match = replayTurnMatch(ticTacToeRules, [
      join('ann'),
      join('bob'),
      move('ann', 0),
      { t: 'forfeit', by: 'ann' },
    ]);
    expect(match.phase).toMatchObject({
      t: 'over',
      result: { round: 0, winners: ['bob'], forfeitedBy: 'ann' },
    });
  });

  it('reopens the table so seats can change before the next round', () => {
    const match = replayTurnMatch(ticTacToeRules, [
      join('ann'),
      join('bob'),
      { t: 'forfeit', by: 'bob' },
      { t: 'reopen', by: 'ann' },
      { t: 'leave', by: 'bob' },
      join('cat'),
    ]);
    expect(match.seats).toEqual(['ann', 'cat']);
    // Refilling the table after a reopen starts the next round.
    expect(match.phase).toMatchObject({ t: 'playing', round: 1 });
  });

  it('waits for an explicit start on tables with optional seats', () => {
    const lobby = replayTurnMatch(dotsAndBoxesRules, [
      join('ann'),
      { t: 'start', by: 'ann' },
      join('bob'),
      join('cat'),
    ]);
    expect(lobby.phase.t).toBe('lobby');
    const started = replayTurnMatch(dotsAndBoxesRules, [
      join('ann'),
      join('bob'),
      join('cat'),
      { t: 'start', by: 'dan' },
      { t: 'start', by: 'cat' },
      join('dan'),
    ]);
    expect(started.seats).toEqual(['ann', 'bob', 'cat']);
    expect(started.phase).toMatchObject({ t: 'playing', turn: 0 });
  });

  it('settles a multi-seat forfeit by the standings', () => {
    const match = replayTurnMatch(dotsAndBoxesRules, [
      join('ann'),
      join('bob'),
      join('cat'),
      { t: 'start', by: 'ann' },
      { t: 'forfeit', by: 'ann' },
    ]);
    // Nobody has a box yet, so both remaining players share the win.
    expect(match.phase).toMatchObject({
      t: 'over',
      result: { winners: ['bob', 'cat'], forfeitedBy: 'ann' },
    });
    expect(seriesWins(match.results).size).toBe(0);
  });
});
