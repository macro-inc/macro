import { describe, expect, it } from 'vitest';
import { layoutMarginCards } from './comment-layout';

const heights = new Map([
  ['a', 50],
  ['b', 50],
  ['c', 50],
]);

describe('layoutMarginCards', () => {
  it('keeps cards at their anchors when they do not overlap', () => {
    const placed = layoutMarginCards(
      [
        { id: 'a', top: 0 },
        { id: 'b', top: 100 },
      ],
      heights,
      null
    );
    expect([...placed]).toEqual([
      ['a', 0],
      ['b', 100],
    ]);
  });

  it('pushes overlapping cards down in anchor order', () => {
    const placed = layoutMarginCards(
      [
        { id: 'b', top: 10 },
        { id: 'a', top: 0 },
        { id: 'c', top: 20 },
      ],
      heights,
      null,
      10
    );
    expect(placed.get('a')).toBe(0);
    expect(placed.get('b')).toBe(60);
    expect(placed.get('c')).toBe(120);
  });

  it('pins the active card and moves its neighbours around it', () => {
    const placed = layoutMarginCards(
      [
        { id: 'a', top: 0 },
        { id: 'b', top: 10 },
        { id: 'c', top: 20 },
      ],
      heights,
      'b',
      10
    );
    expect(placed.get('b')).toBe(10);
    expect(placed.get('a')).toBe(-50);
    expect(placed.get('c')).toBe(70);
  });
});
