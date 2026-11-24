import { expect, it } from 'vitest';
import { holdInPlace } from './hold';

it('keeps a row that left the list where it was', () => {
  expect(holdInPlace(['a', 'c'], ['b'], ['a', 'b', 'c'])).toEqual([
    'a',
    'b',
    'c',
  ]);
});

it('keeps a first row first, and rows that left together in their order', () => {
  expect(holdInPlace(['d'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toEqual([
    'a',
    'b',
    'c',
    'd',
  ]);
});

it('follows the server’s new order for the rest', () => {
  expect(holdInPlace(['c', 'a'], ['b'], ['a', 'b', 'c'])).toEqual([
    'c',
    'a',
    'b',
  ]);
});

it('puts a held row it never showed last', () => {
  expect(holdInPlace(['a'], ['z'], [])).toEqual(['a', 'z']);
});
