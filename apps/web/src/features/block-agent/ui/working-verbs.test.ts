import { describe, expect, it } from 'vitest';
import { createVerbDraw, VERBS } from './working-verbs';

describe('createVerbDraw', () => {
  it('spends the whole list before repeating a verb', () => {
    const draw = createVerbDraw();
    const drawn = Array.from({ length: VERBS.length }, draw);

    expect(new Set(drawn).size).toBe(VERBS.length);
  });

  it('reshuffles rather than running dry', () => {
    const draw = createVerbDraw();
    const drawn = Array.from({ length: VERBS.length * 3 }, draw);

    expect(drawn.every((verb) => VERBS.includes(verb))).toBe(true);
  });

  it('offers gerunds only, so any two read as the same kind of word', () => {
    expect(VERBS.every((verb) => verb.endsWith('ing'))).toBe(true);
  });
});
