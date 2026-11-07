import { describe, expect, test } from 'bun:test';
import { asciiSpellings, spellAddresses } from './personas';

/** Every text spelled with the spellings found across all of them, as seeding does for one persona. */
const spell = (texts: string[]) => spellAddresses(texts, asciiSpellings(texts));

describe('asciiSpellings', () => {
  test('leaves ASCII addresses alone', () => {
    const texts = ['ana@acme.example', "o'neil@acme.example"];
    expect(asciiSpellings(texts).size).toBe(0);
    expect(spell(texts)).toEqual(texts);
  });

  test('drops accents, keeping apostrophes inside a local part and those quoting it', () => {
    expect(spell(["pád'raig@acme.example", "iñès''neil@acme.example", "'inès@acme.example'"])).toEqual([
      "pad'raig@acme.example",
      "ines''neil@acme.example",
      "'ines@acme.example'",
    ]);
  });

  test('spells an address the same bare, bracketed or in angle brackets', () => {
    expect(spell(['inès@acme.example', '[inès@acme.example]', 'Inès <inès@acme.example>'])).toEqual([
      'ines@acme.example',
      '[ines@acme.example]',
      'Inès <ines@acme.example>',
    ]);
  });

  test('never merges a respelled address with another of the persona', () => {
    const [accented, plain, other] = spell(['inès@acme.example', 'ines@acme.example', '[inés@acme.example]']);
    expect(plain).toBe('ines@acme.example');
    expect(accented).toMatch(/^ines-[0-9a-z]+@acme\.example$/);
    expect(other).toMatch(/^\[ines-[0-9a-z]+@acme\.example\]$/);
    expect(other).not.toBe(`[${accented}]`);
    const [bare, bracketed] = spell(['inès@acme.example', '[inès@acme.example]', 'ines@acme.example']);
    expect(bare).toMatch(/^ines-[0-9a-z]+@acme\.example$/);
    expect(bracketed).toBe(`[${bare}]`);
  });

  test('never merges with an address that differs only in case', () => {
    const [upper, accented] = spell(['Ines@acme.example', 'inès@acme.example']);
    expect(upper).toBe('Ines@acme.example');
    expect(accented).toMatch(/^ines-[0-9a-z]+@acme\.example$/);
    const [lower, capital] = spell(['ines@acme.example', 'Inès@acme.example']);
    expect(lower).toBe('ines@acme.example');
    expect(capital).toMatch(/^Ines-[0-9a-z]+@acme\.example$/);
  });

  test('never leaves a local part empty or with empty dot runs', () => {
    expect(spell(['李.a@acme.example', 'b.李@acme.example', 'c.李.d@acme.example'])).toEqual([
      'a@acme.example',
      'b@acme.example',
      'c.d@acme.example',
    ]);
    expect(spell(['李@acme.example'])[0]).toMatch(/^x-[0-9a-z]+@acme\.example$/);
  });
});
