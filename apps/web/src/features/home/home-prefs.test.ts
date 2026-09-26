import { describe, expect, it } from 'vitest';
import { parseDismissedCards } from './home-prefs';

describe('parseDismissedCards', () => {
  it('accepts known home cards', () => {
    expect(parseDismissedCards('["getting-started-link"]')).toEqual([
      'getting-started-link',
    ]);
  });

  it('drops unknown, retired, and non-string entries', () => {
    expect(
      parseDismissedCards('["getting-started-link","examples","setup",12]')
    ).toEqual(['getting-started-link']);
  });

  it('returns empty for a non-array shape', () => {
    expect(parseDismissedCards('{}')).toEqual([]);
  });

  it('returns empty for malformed JSON', () => {
    expect(parseDismissedCards('{')).toEqual([]);
  });
});
