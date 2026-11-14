import { describe, expect, it } from 'vitest';
import { recommendedVoice } from './voices';

const arcas = {
  model: 'aura-2-arcas-en',
  name: 'Arcas',
  accent: 'American',
  tags: ['masculine', 'confident'],
  languages: ['en'],
};
const thalia = {
  model: 'aura-2-thalia-en',
  name: 'Thalia',
  accent: 'American',
  tags: ['feminine', 'warm'],
  languages: ['en-US'],
};
const celeste = {
  model: 'aura-2-celeste-es',
  name: 'Celeste',
  accent: 'Colombian',
  tags: ['warm'],
  languages: ['es'],
};

describe('recommendedVoice', () => {
  it('picks the English voice whose tag the personality uses', () => {
    expect(
      recommendedVoice([celeste, arcas, thalia], 'Warm and concise.')
    ).toBe(thalia);
  });

  it('falls back to the first English voice when no tag matches', () => {
    expect(recommendedVoice([celeste, arcas, thalia], 'Asks first.')).toBe(
      arcas
    );
  });

  it('uses any voice when none speak English, and nothing when empty', () => {
    expect(recommendedVoice([celeste], '')).toBe(celeste);
    expect(recommendedVoice([], 'warm')).toBeUndefined();
  });
});
