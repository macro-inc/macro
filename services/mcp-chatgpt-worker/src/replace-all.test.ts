import { describe, expect, it } from 'vitest';
import { replaceAll } from './replace-all';

const upper = async ([match]: RegExpExecArray) => match.toUpperCase();

describe('replaceAll', () => {
  it('replaces every match with what the replacer resolves, in order', async () => {
    expect(
      await replaceAll('a1b22c333', /\d+/g, async ([n]) => `<${n.length}>`)
    ).toBe('a<1>b<2>c<3>');
  });

  it('returns the text unchanged when nothing matches', async () => {
    expect(await replaceAll('nothing here', /\d/g, upper)).toBe('nothing here');
  });

  it('passes capture groups and keeps the text around matches', async () => {
    expect(
      await replaceAll(
        'x=1, y=2.',
        /(\w)=(\d)/g,
        async ([, k, v]) => `${v}=${k}`
      )
    ).toBe('1=x, 2=y.');
  });

  it('keeps order when replacers finish out of order', async () => {
    const slowFirst = async ([m]: RegExpExecArray) => {
      await new Promise((r) => setTimeout(r, m === 'a' ? 20 : 0));
      return m.toUpperCase();
    };
    expect(await replaceAll('a-b-c', /[abc]/g, slowFirst)).toBe('A-B-C');
  });

  it('handles matches at the edges of the text', async () => {
    expect(await replaceAll('ab', /[ab]/g, upper)).toBe('AB');
  });
});
