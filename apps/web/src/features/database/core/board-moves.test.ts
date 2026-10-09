import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import type { Board } from '../../../lib/core/database-sql/generated/types';
import {
  cardMove,
  laneCards,
  placeCard,
  withMovedCards,
  withPositions,
} from './board-moves';

/** Spells out which bounds a key was asked between. */
const keyBetween = (before: string | null, after: string | null) =>
  `(${before ?? '-'}..${after ?? '-'})`;

const board: Board = {
  lanes: [
    { key: { kind: 'none' }, hidden: false, cards: [] },
    {
      key: { kind: 'option', id: 'yes' },
      hidden: false,
      cards: ['ann', 'bob', 'cat'],
    },
    { key: { kind: 'option', id: 'no' }, hidden: false, cards: ['dan'] },
  ],
};

describe('a card dropped on the board', () => {
  it('lands after the card above it and before the card below it', () => {
    expect(
      cardMove(board, 'dan', { kind: 'option', id: 'yes' }, 'bob')
    ).toEqual({
      row: 'dan',
      lane: { kind: 'option', id: 'yes' },
      before: 'ann',
      after: 'bob',
    });
  });

  it('dropped first in a lane has only a card below it', () => {
    expect(
      cardMove(board, 'dan', { kind: 'option', id: 'yes' }, 'ann')
    ).toEqual({
      row: 'dan',
      lane: { kind: 'option', id: 'yes' },
      before: null,
      after: 'ann',
    });
  });

  it('dropped at the end of a lane has only a card above it', () => {
    expect(
      cardMove(board, 'ann', { kind: 'option', id: 'no' }, undefined)
    ).toEqual({
      row: 'ann',
      lane: { kind: 'option', id: 'no' },
      before: 'dan',
      after: null,
    });
  });

  it('dropped in an empty lane has no neighbours', () => {
    expect(cardMove(board, 'ann', { kind: 'none' }, undefined)).toEqual({
      row: 'ann',
      lane: { kind: 'none' },
      before: null,
      after: null,
    });
  });

  it('moved within its lane skips itself when finding neighbours', () => {
    expect(
      cardMove(board, 'ann', { kind: 'option', id: 'yes' }, undefined)
    ).toEqual({
      row: 'ann',
      lane: { kind: 'option', id: 'yes' },
      before: 'cat',
      after: null,
    });
    expect(
      cardMove(board, 'cat', { kind: 'option', id: 'yes' }, 'bob')
    ).toEqual({
      row: 'cat',
      lane: { kind: 'option', id: 'yes' },
      before: 'ann',
      after: 'bob',
    });
  });

  it('dropped back where it was is no move', () => {
    expect(
      cardMove(board, 'bob', { kind: 'option', id: 'yes' }, 'cat')
    ).toBeUndefined();
    expect(
      cardMove(board, 'cat', { kind: 'option', id: 'yes' }, undefined)
    ).toBeUndefined();
  });
});

describe('a moved card, placed before the server answers', () => {
  it('takes a key between its placed neighbours', () => {
    expect(
      placeCard(
        [
          { row: 'ann', position: 'a0' },
          { row: 'bob', position: 'a1' },
        ],
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          before: 'ann',
          after: 'bob',
        },
        keyBetween
      )
    ).toEqual(
      ok([
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          position: '(a0..a1)',
        },
      ])
    );
  });

  it('takes a key before the first card, or after the last', () => {
    expect(
      placeCard(
        [{ row: 'ann', position: 'a0' }],
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          before: null,
          after: 'ann',
        },
        keyBetween
      )
    ).toEqual(
      ok([
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          position: '(-..a0)',
        },
      ])
    );
    expect(
      placeCard(
        [{ row: 'ann', position: 'a0' }],
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          before: 'ann',
          after: null,
        },
        keyBetween
      )
    ).toEqual(
      ok([
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          position: '(a0..-)',
        },
      ])
    );
  });

  it('places the unplaced cards above it first, in their order, as the server does', () => {
    expect(
      placeCard(
        [
          { row: 'ann', position: 'a0' },
          { row: 'bob', position: null },
          { row: 'cat', position: null },
        ],
        { row: 'dan', lane: { kind: 'none' }, before: 'cat', after: null },
        keyBetween
      )
    ).toEqual(
      ok([
        { row: 'bob', lane: { kind: 'none' }, position: '(a0..-)' },
        { row: 'cat', lane: { kind: 'none' }, position: '((a0..-)..-)' },
        { row: 'dan', lane: { kind: 'none' }, position: '(((a0..-)..-)..-)' },
      ])
    );
  });

  it('refuses neighbours that are not next to each other, as the server does', () => {
    expect(
      placeCard(
        [
          { row: 'ann', position: 'a0' },
          { row: 'bob', position: 'a1' },
          { row: 'cat', position: 'a2' },
        ],
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          before: 'ann',
          after: 'cat',
        },
        keyBetween
      )
    ).toEqual(err({ kind: 'not-adjacent', before: 'ann', after: 'cat' }));
    expect(
      placeCard(
        [
          { row: 'ann', position: 'a0' },
          { row: 'bob', position: 'a1' },
        ],
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          before: 'bob',
          after: 'ann',
        },
        keyBetween
      )
    ).toEqual(err({ kind: 'not-adjacent', before: 'bob', after: 'ann' }));
  });

  it('refuses a neighbour that is not in the lane', () => {
    expect(
      placeCard(
        [{ row: 'ann', position: 'a0' }],
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          before: 'eve',
          after: null,
        },
        keyBetween
      )
    ).toEqual(err({ kind: 'not-in-lane', row: 'eve' }));
    expect(
      placeCard(
        [{ row: 'ann', position: 'a0' }],
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          before: 'ann',
          after: 'eve',
        },
        keyBetween
      )
    ).toEqual(err({ kind: 'not-in-lane', row: 'eve' }));
  });

  it('reads a lane in display order with the places stored for that lane only', () => {
    expect(
      laneCards(
        board,
        [
          { row: 'ann', lane: { kind: 'option', id: 'yes' }, position: 'a0' },
          { row: 'bob', lane: { kind: 'option', id: 'no' }, position: 'a5' },
          { row: 'cat', lane: { kind: 'option', id: 'yes' }, position: 'a1' },
        ],
        { kind: 'option', id: 'yes' },
        'cat'
      )
    ).toEqual([
      { row: 'ann', position: 'a0' },
      { row: 'bob', position: null },
    ]);
  });

  it('replaces the places of the cards it wrote and keeps the rest', () => {
    expect(
      withPositions(
        [
          { row: 'ann', lane: { kind: 'option', id: 'yes' }, position: 'a0' },
          { row: 'dan', lane: { kind: 'option', id: 'no' }, position: 'a0' },
        ],
        [{ row: 'dan', lane: { kind: 'option', id: 'yes' }, position: 'a1' }]
      )
    ).toEqual([
      { row: 'ann', lane: { kind: 'option', id: 'yes' }, position: 'a0' },
      { row: 'dan', lane: { kind: 'option', id: 'yes' }, position: 'a1' },
    ]);
  });
});

describe('a moved card, shown before its row is read again', () => {
  it('leaves its old lane for its new one, between its neighbours', () => {
    expect(
      withMovedCards(board, [
        {
          row: 'dan',
          lane: { kind: 'option', id: 'yes' },
          before: 'ann',
          after: 'bob',
        },
      ])
    ).toEqual({
      lanes: [
        { key: { kind: 'none' }, hidden: false, cards: [] },
        {
          key: { kind: 'option', id: 'yes' },
          hidden: false,
          cards: ['ann', 'dan', 'bob', 'cat'],
        },
        { key: { kind: 'option', id: 'no' }, hidden: false, cards: [] },
      ],
    });
  });

  it('goes before its lower neighbour when it has no upper one, and last with neither', () => {
    expect(
      withMovedCards(board, [
        {
          row: 'cat',
          lane: { kind: 'option', id: 'yes' },
          before: null,
          after: 'ann',
        },
        { row: 'bob', lane: { kind: 'none' }, before: null, after: null },
      ])
    ).toEqual({
      lanes: [
        { key: { kind: 'none' }, hidden: false, cards: ['bob'] },
        {
          key: { kind: 'option', id: 'yes' },
          hidden: false,
          cards: ['cat', 'ann'],
        },
        { key: { kind: 'option', id: 'no' }, hidden: false, cards: ['dan'] },
      ],
    });
  });
});
