import { describe, expect, it } from 'vitest';
import { dedupeContentHits } from './dedupe-content-hits';
import type { ContentHitData } from '../types/search';

const hit = (content: string): ContentHitData =>
  ({ type: undefined, content }) as ContentHitData;

describe('dedupeContentHits', () => {
  it('returns the input unchanged when there are 0 or 1 hits', () => {
    expect(dedupeContentHits([])).toEqual([]);
    const single = [hit('hello')];
    expect(dedupeContentHits(single)).toEqual(single);
  });

  it('drops hits whose content is identical to another hit', () => {
    const hits = [hit('hello world'), hit('hello world')];
    expect(dedupeContentHits(hits)).toEqual([hit('hello world')]);
  });

  it('drops hits whose content is a substring of another hit', () => {
    const hits = [hit('hello'), hit('hello world')];
    const result = dedupeContentHits(hits);
    expect(result.map((h) => h.content)).toEqual(['hello world']);
  });

  it('keeps hits with distinct content', () => {
    const hits = [hit('alpha'), hit('beta'), hit('gamma')];
    expect(dedupeContentHits(hits)).toEqual(hits);
  });

  it('preserves original order', () => {
    const hits = [hit('alpha'), hit('beta extra text'), hit('beta')];
    const result = dedupeContentHits(hits);
    expect(result.map((h) => h.content)).toEqual(['alpha', 'beta extra text']);
  });

  it('ignores macro_em tags when comparing', () => {
    const hits = [
      hit('the <macro_em>quick</macro_em> brown fox'),
      hit('the quick brown fox'),
    ];
    const result = dedupeContentHits(hits);
    expect(result).toHaveLength(1);
  });

  it('normalizes whitespace differences', () => {
    const hits = [hit('hello   world'), hit('hello\nworld')];
    const result = dedupeContentHits(hits);
    expect(result).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    const hits = [hit('Hello World'), hit('hello world')];
    const result = dedupeContentHits(hits);
    expect(result).toHaveLength(1);
  });

  it('drops hits with empty or whitespace-only content', () => {
    const hits = [hit('hello'), hit('   '), hit('')];
    const result = dedupeContentHits(hits);
    expect(result.map((h) => h.content)).toEqual(['hello']);
  });
});
