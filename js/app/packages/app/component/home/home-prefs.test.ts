import { describe, expect, it } from 'vitest';
import { parseDismissedCards } from './home-prefs';

describe('parseDismissedCards', () => {
  it('accepts known home cards', () => {
    expect(parseDismissedCards('["examples","setup"]')).toEqual([
      'examples',
      'setup',
    ]);
  });

  it('drops unknown and non-string entries', () => {
    expect(parseDismissedCards('["examples","unknown",12]')).toEqual([
      'examples',
    ]);
  });

  it('returns empty for a non-array shape', () => {
    expect(parseDismissedCards('{}')).toEqual([]);
  });

  it('returns empty for malformed JSON', () => {
    expect(parseDismissedCards('{')).toEqual([]);
  });
});
