import { describe, expect, it } from 'vitest';
import { compareSoupNames } from './transforms';

describe('compareSoupNames', () => {
  it('matches the order Postgres reads from lower(name) COLLATE "und-x-icu"', () => {
    // Captured from Postgres ordering `lower(name) COLLATE "und-x-icu"`.
    const server = [
      '',
      '.dot',
      '(x) paren',
      '[draft]',
      '#tag',
      '1 task',
      '1. Intro',
      '10 task',
      '10. Wrap',
      '2 task',
      '2. Setup',
      'a b',
      'a_c',
      'a-b',
      'ab',
      'Ärger',
      'émile',
      'Emma',
      'ss',
      'ß',
      'straße',
      'zebra',
      'Ω omega',
    ];

    expect([...server].reverse().sort(compareSoupNames)).toEqual(server);
  });

  it('ties names that differ only by case and puts missing names last', () => {
    expect(compareSoupNames('Apple', 'apple')).toBe(0);
    expect(compareSoupNames(undefined, 'a')).toBe(1);
    expect(compareSoupNames('', null)).toBe(-1);
    expect(compareSoupNames(null, undefined)).toBe(0);
  });
});
