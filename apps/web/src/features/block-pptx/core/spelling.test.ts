import { describe, expect, it } from 'vitest';
import {
  createSpeller,
  expandDictionary,
  isIgnoredByDefault,
  misspelledWords,
  parseAffixes,
  tokenize,
  typoDistance,
} from './spelling';

/** A few rules in the shape of the en_US affix file. */
const AFF = `SET UTF-8
NOSUGGEST !

PFX U Y 1
PFX U   0     un         .

SFX S Y 4
SFX S   y     ies        [^aeiou]y
SFX S   0     s          [aeiou]y
SFX S   0     es         [sxzh]
SFX S   0     s          [^sxzhy]

SFX D Y 4
SFX D   0     d          e
SFX D   y     ied        [^aeiou]y
SFX D   0     ed         [^ey]
SFX D   0     ed         [aeiou]y

SFX M Y 1
SFX M   0     's         .

REP 2
REP alot a_lot
REP ie ei
`;

const DIC = `14
the
for
at
lot
a
receive/D
strategy/S
happy/U
box/S
Paris/M
lock/UD
quarterly
revenue
darn/!
`;

const lexicon = expandDictionary(DIC, parseAffixes(AFF));
const speller = createSpeller(lexicon);

describe('dictionary expansion', () => {
  it('applies suffixes with their conditions and strips', () => {
    for (const w of ['strategies', 'boxes', 'received', "Paris's"])
      expect(lexicon.words.has(w), w).toBe(true);
    expect(lexicon.words.has('strategys')).toBe(false);
    expect(lexicon.words.has('receiveed')).toBe(false);
  });

  it('combines prefixes and suffixes that allow it', () => {
    expect(lexicon.words.has('unhappy')).toBe(true);
    expect(lexicon.words.has('unlocked')).toBe(true);
  });

  it('accepts taboo words but never suggests them', () => {
    expect(speller.correct('darn')).toBe(true);
    expect(speller.suggest('darm')).not.toContain('darn');
  });
});

describe('checking', () => {
  it('accepts sentence-start and all-caps forms of lowercase words', () => {
    expect(speller.correct('The')).toBe(true);
    expect(speller.correct('THE')).toBe(true);
    expect(speller.correct('Revenue')).toBe(true);
  });

  it('keeps the capital of proper nouns', () => {
    expect(speller.correct('Paris')).toBe(true);
    expect(speller.correct('paris')).toBe(false);
  });

  it('accepts possessives and curly apostrophes', () => {
    expect(speller.correct('strategy’s')).toBe(true);
    expect(speller.correct("boxes'")).toBe(true);
  });
});

describe('suggestions', () => {
  it('ranks likely slips first, in the case of the misspelling', () => {
    expect(speller.suggest('teh')[0]).toBe('the');
    expect(speller.suggest('Teh')[0]).toBe('The');
    expect(speller.suggest('recieve')[0]).toBe('receive');
    expect(speller.suggest('stratgy')[0]).toBe('strategy');
    expect(speller.suggest('REVENEU')[0]).toBe('REVENUE');
  });

  it('uses the affix file’s replacement table', () => {
    expect(speller.suggest('alot')).toContain('a lot');
  });

  it('respects the limit', () => {
    expect(speller.suggest('lots', 1)).toHaveLength(1);
  });

  it('weights neighboring keys, swaps, and doubled letters lower', () => {
    expect(typoDistance('teh', 'the')).toBeLessThan(1);
    expect(typoDistance('mispelled', 'misspelled')).toBe(0.5);
    expect(typoDistance('cst', 'cat')).toBeLessThan(typoDistance('cmt', 'cat'));
    expect(typoDistance('same', 'same')).toBe(0);
  });
});

describe('tokens', () => {
  it('counts code points and keeps inner apostrophes', () => {
    expect(tokenize('😀 don’t stop')).toEqual([
      { word: 'don’t', start: 2, end: 7 },
      { word: 'stop', start: 8, end: 12 },
    ]);
  });

  it('splits hyphenated words and line breaks', () => {
    expect(tokenize('well-known\u000bline').map((t) => t.word)).toEqual([
      'well',
      'known',
      'line',
    ]);
  });

  it('skips web addresses, e-mail addresses, and file names', () => {
    const words = tokenize(
      'See https://macro.com/x, www.example.org, ann@example.com, deck.pptx now'
    ).map((t) => t.word);
    expect(words).toEqual(['See', 'now']);
  });

  it('skips words with digits and ALL-CAPS words by default', () => {
    expect(isIgnoredByDefault('Q3')).toBe(true);
    expect(isIgnoredByDefault('ACME')).toBe(true);
    expect(isIgnoredByDefault('Acme')).toBe(false);
    expect(isIgnoredByDefault('I')).toBe(false);
  });
});

describe('misspelled words', () => {
  it('finds the misspellings of a paragraph with their positions', () => {
    expect(
      misspelledWords('Teh quarterly revnue for Q3 at ACME', speller)
    ).toEqual([
      { word: 'Teh', start: 0, end: 3 },
      { word: 'revnue', start: 14, end: 20 },
    ]);
  });

  it('leaves words a person accepted', () => {
    const accepted = new Set(['revnue']);
    expect(
      misspelledWords('Teh revnue', speller, accepted).map((w) => w.word)
    ).toEqual(['Teh']);
  });
});
