import type { GameLogEntry } from './game-log';

export type TurnProgress =
  | { t: 'turn'; seat: number }
  /** An empty winner list is a draw. */
  | { t: 'over'; winners: number[] };

/** The rules a turn-based game supplies; the match engine owns everything else. */
export type TurnRules<State, Move> = {
  seats: { min: number; max: number };
  /** Begin the first round as soon as the last seat fills. */
  autoStart: boolean;
  /** The opening position. Implementations rotate the first player by round. */
  initial(players: number, round: number): State;
  parseMove(value: unknown): Move | undefined;
  /** The next position, or undefined when `seat` may not make `move`. */
  apply(state: State, move: Move, seat: number): State | undefined;
  progress(state: State): TurnProgress;
  /** Points per seat, used to settle a forfeit in games with more than two seats. */
  standings?(state: State): number[];
};

export type RoundResult = {
  /** Zero-based, and stable across peers: it keys the backend win record. */
  round: number;
  /** Everyone seated for the round. */
  players: string[];
  /** Winning user ids; empty for a draw. */
  winners: string[];
  forfeitedBy?: string;
};

export type TurnPhase<State> =
  | { t: 'lobby' }
  | { t: 'playing'; round: number; state: State; turn: number }
  | { t: 'over'; round: number; state: State; result: RoundResult };

export type TurnMatch<State> = {
  /** Seated user ids in seat order. */
  seats: string[];
  phase: TurnPhase<State>;
  /** Every finished round, oldest first. */
  results: RoundResult[];
};

/**
 * Replay a room log. Entries that are not legal at their position (a second
 * move in the same turn, a join after the start, a stranger's move) are
 * ignored, which is what resolves concurrent actions deterministically.
 */
export function replayTurnMatch<State, Move>(
  rules: TurnRules<State, Move>,
  log: readonly GameLogEntry[]
): TurnMatch<State> {
  let seats: string[] = [];
  // Widened explicitly: assignments happen inside the helpers below, which
  // control-flow narrowing cannot see.
  let phase = { t: 'lobby' } as TurnPhase<State>;
  let nextRound = 0;
  const results: RoundResult[] = [];

  const finish = (
    round: number,
    state: State,
    winnerSeats: number[],
    forfeitedBy?: string
  ) => {
    const result: RoundResult = {
      round,
      players: seats,
      winners: winnerSeats.map((seat) => seats[seat]),
      ...(forfeitedBy ? { forfeitedBy } : {}),
    };
    results.push(result);
    phase = { t: 'over', round, state, result };
  };

  const settle = (round: number, state: State) => {
    const progress = rules.progress(state);
    if (progress.t === 'over') finish(round, state, progress.winners);
    else phase = { t: 'playing', round, state, turn: progress.seat };
  };

  const begin = () => {
    const round = nextRound;
    nextRound += 1;
    settle(round, rules.initial(seats.length, round));
  };

  // Each action is legal in exactly one phase; anything else is ignored.
  const inLobby = (entry: GameLogEntry, seat: number) => {
    if (entry.t === 'join') {
      if (seat >= 0 || seats.length >= rules.seats.max) return;
      seats = [...seats, entry.by];
      if (rules.autoStart && seats.length === rules.seats.max) begin();
    } else if (entry.t === 'leave') {
      if (seat >= 0) seats = seats.filter((user) => user !== entry.by);
    } else if (entry.t === 'start') {
      if (seat >= 0 && seats.length >= rules.seats.min) begin();
    }
  };

  const whilePlaying = (
    current: Extract<TurnPhase<State>, { t: 'playing' }>,
    entry: GameLogEntry,
    seat: number
  ) => {
    if (entry.t === 'move') {
      if (seat !== current.turn) return;
      const move = rules.parseMove(entry.move);
      if (move === undefined) return;
      const next = rules.apply(current.state, move, seat);
      if (next !== undefined) settle(current.round, next);
    } else if (entry.t === 'forfeit') {
      if (seat < 0) return;
      finish(
        current.round,
        current.state,
        forfeitWinners(rules, current.state, seats.length, seat),
        entry.by
      );
    }
  };

  const afterRound = (entry: GameLogEntry, seat: number) => {
    if (seat < 0) return;
    if (entry.t === 'rematch') begin();
    else if (entry.t === 'reopen') phase = { t: 'lobby' };
  };

  for (const entry of log) {
    const seat = seats.indexOf(entry.by);
    if (phase.t === 'lobby') inLobby(entry, seat);
    else if (phase.t === 'playing') whilePlaying(phase, entry, seat);
    else afterRound(entry, seat);
  }

  return { seats, phase, results };
}

/** The best-placed remaining seats win; with two seats, the opponent. */
function forfeitWinners<State, Move>(
  rules: TurnRules<State, Move>,
  state: State,
  players: number,
  forfeiter: number
): number[] {
  const others = Array.from({ length: players }, (_, seat) => seat).filter(
    (seat) => seat !== forfeiter
  );
  const standings = rules.standings?.(state);
  if (!standings) return others;
  const best = Math.max(...others.map((seat) => standings[seat] ?? 0));
  return others.filter((seat) => (standings[seat] ?? 0) === best);
}

/** Rounds won outright per user; shared wins and draws are not counted. */
export function seriesWins(
  results: readonly RoundResult[]
): Map<string, number> {
  const wins = new Map<string, number>();
  for (const result of results) {
    if (result.winners.length !== 1) continue;
    const [winner] = result.winners;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  return wins;
}
