/**
 * A dragged card as the `move_card` op names it and as it shows before the
 * answer; placement mirrors `models_databases::views::lanes::place_card`.
 */

import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import { err, ok, Result } from 'neverthrow';
import type {
  Board,
  LaneKey,
} from '../../../lib/core/database-sql/generated/types';
import { sameLane } from './views';

/** A card's move: `before` is the card it lands right after, `after` the one right before it. */
export type CardMove = {
  row: string;
  lane: LaneKey;
  before: string | null;
  after: string | null;
};

/** The fractional key between two others; `null` leaves that side open. */
type KeyBetween = (before: string | null, after: string | null) => string;

/** One lane's cards as the board shows them, with the place stored for that lane. */
type LaneCard = { row: string; position: string | null };

/** The cards a lane of the board shows, in order. */
export function cardsOf(board: Board, lane: LaneKey): string[] {
  return board.lanes.find((entry) => sameLane(entry.key, lane))?.cards ?? [];
}

/**
 * The move a drop makes: `row` dropped into `lane` in front of `next`, or at
 * the lane's end without one. Dropping a card back where it was is no move.
 */
export function cardMove(
  board: Board,
  row: string,
  lane: LaneKey,
  next: string | undefined
): CardMove | undefined {
  const shown = cardsOf(board, lane);
  const others = shown.filter((card) => card !== row);
  const index = next === undefined ? others.length : others.indexOf(next);
  if (index < 0) return undefined;
  const before = others[index - 1] ?? null;
  const after = others[index] ?? null;
  if (shown.includes(row) && shown.indexOf(row) === index) return undefined;
  return { row, lane, before, after };
}

/** A lane's cards in display order with their stored places there, without `except`. */
export function laneCards(
  board: Board,
  positions: readonly CardPosition[],
  lane: LaneKey,
  except: string
): LaneCard[] {
  return cardsOf(board, lane)
    .filter((row) => row !== except)
    .map((row) => ({
      row,
      position:
        positions.find(
          (placed) => placed.row === row && sameLane(placed.lane, lane)
        )?.position ?? null,
    }));
}

/** Why a move has no place in the lane, as `PlacementError` says. */
export type PlacementFailure =
  /** A neighbour named is not a card of the lane. */
  | { kind: 'not-in-lane'; row: string }
  /** `after` is not the card right after `before`, so nothing sits between them. */
  | { kind: 'not-adjacent'; before: string; after: string };

/** Where `move` lands in `lane`, by its named neighbours. */
function landingIndex(
  lane: readonly LaneCard[],
  move: CardMove
): Result<number, PlacementFailure> {
  const indexOf = (row: string): Result<number, PlacementFailure> => {
    const index = lane.findIndex((card) => card.row === row);
    return index < 0 ? err({ kind: 'not-in-lane', row }) : ok(index);
  };
  const { before, after } = move;
  if (before !== null && after !== null)
    return Result.combine([indexOf(before), indexOf(after)]).andThen(
      ([upper, lower]) =>
        lower === upper + 1
          ? ok(lower)
          : err<number, PlacementFailure>({
              kind: 'not-adjacent',
              before,
              after,
            })
    );
  if (before !== null) return indexOf(before).map((index) => index + 1);
  if (after !== null) return indexOf(after);
  return ok(lane.length);
}

/**
 * The places a move writes. Placed cards lead a lane and unplaced ones follow
 * in table order, so a card landing among the unplaced places those above it
 * first, each after the last.
 */
export function placeCard(
  lane: readonly LaneCard[],
  move: CardMove,
  keyBetween: KeyBetween
): Result<CardPosition[], PlacementFailure> {
  return landingIndex(lane, move).map((index) => {
    const placedCount = lane.findIndex((card) => card.position === null);
    const positioned = placedCount < 0 ? lane.length : placedCount;
    if (index <= positioned) {
      const lower = lane[index - 1]?.position ?? null;
      const upper = index < positioned ? (lane[index]?.position ?? null) : null;
      return [
        { row: move.row, lane: move.lane, position: keyBetween(lower, upper) },
      ];
    }
    let lower = lane[positioned - 1]?.position ?? null;
    return [
      ...lane.slice(positioned, index).map((card) => card.row),
      move.row,
    ].map((row) => {
      lower = keyBetween(lower, null);
      return { row, lane: move.lane, position: lower };
    });
  });
}

/** `positions` with the cards in `placed` at their new places. */
export function withPositions(
  positions: readonly CardPosition[],
  placed: readonly CardPosition[]
): CardPosition[] {
  const moved = new Set(placed.map((card) => card.row));
  return [...positions.filter((card) => !moved.has(card.row)), ...placed];
}

/**
 * The board with `moves` applied in order: each card taken from where it is
 * and put between its neighbours, as it shows until its row is read again.
 */
export function withMovedCards(
  board: Board,
  moves: readonly CardMove[]
): Board {
  return moves.reduce(
    (current, move) => ({
      lanes: current.lanes.map((lane) => {
        const cards = lane.cards.filter((card) => card !== move.row);
        if (!sameLane(lane.key, move.lane)) return { ...lane, cards };
        const upper = move.before === null ? -1 : cards.indexOf(move.before);
        const lower = move.after === null ? -1 : cards.indexOf(move.after);
        const index =
          upper >= 0 ? upper + 1 : lower >= 0 ? lower : cards.length;
        return {
          ...lane,
          cards: [...cards.slice(0, index), move.row, ...cards.slice(index)],
        };
      }),
    }),
    board
  );
}
