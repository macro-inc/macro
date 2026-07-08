import { afterEach, describe, expect, it } from 'vitest';
import { resolveEmoji, searchEmojis } from './emojis';
import {
  clearEmojiUsage,
  frequentEmojiChars,
  recordEmojiUsage,
} from './emojiUsage';

describe('searchEmojis', () => {
  const first = (query: string) => searchEmojis(query)[0]?.emoji;

  it('ranks exact name matches first', () => {
    expect(first('heart')).toBe('❤️');
    expect(first('fire')).toBe('🔥');
    expect(first('cry')).toBe('😢');
    expect(first('sob')).toBe('😭');
    expect(first('tada')).toBe('🎉');
    expect(first('joy')).toBe('😂');
    expect(first('100')).toBe('💯');
    expect(first('rocket')).toBe('🚀');
    expect(first('dog')).toBe('🐶');
  });

  it('ranks name prefix matches above name word-boundary matches', () => {
    const emojis = searchEmojis('hear').map(({ emoji }) => emoji);
    expect(emojis.indexOf('❤️')).toBeGreaterThanOrEqual(0);
    expect(emojis.indexOf('❤️')).toBeLessThan(emojis.indexOf('💔'));
  });

  it('matches multi-word queries', () => {
    expect(first('thumbs up')).toBe('\u{1f44d}');
    expect(first('broken heart')).toBe('💔');
  });

  it('matches by keyword when no name matches', () => {
    expect(searchEmojis('sad').map(({ emoji }) => emoji)).toContain('😢');
  });

  it('matches CLDR tags missing from emojilib keywords', () => {
    expect(
      searchEmojis('celebrate')
        .slice(0, 5)
        .map(({ emoji }) => emoji)
    ).toContain('🎉');
    expect(
      searchEmojis('lmao')
        .slice(0, 5)
        .map(({ emoji }) => emoji)
    ).toContain('😂');
    expect(
      searchEmojis('lit')
        .slice(0, 5)
        .map(({ emoji }) => emoji)
    ).toContain('🔥');
  });

  it('returns the full ordered list for empty queries', () => {
    expect(searchEmojis('').length).toBeGreaterThan(1800);
    expect(searchEmojis('  ').length).toBeGreaterThan(1800);
  });

  it('returns nothing for queries with no match', () => {
    expect(searchEmojis('zzzzqqq')).toHaveLength(0);
  });
});

describe('emoji usage frecency', () => {
  const first = (query: string) => searchEmojis(query)[0]?.emoji;

  afterEach(() => {
    clearEmojiUsage();
  });

  it('boosts frequently used emojis within the same match tier', () => {
    expect(first('crying')).toBe('🤣');
    recordEmojiUsage('😭');
    expect(first('crying')).toBe('😭');
  });

  it('never outranks a better match tier', () => {
    recordEmojiUsage('😭');
    recordEmojiUsage('😭');
    expect(first('cry')).toBe('😢');
  });

  it('orders frequently used emojis by count', () => {
    recordEmojiUsage('🎉');
    recordEmojiUsage('🎉');
    recordEmojiUsage('🔥');
    expect(frequentEmojiChars(2)).toEqual(['🎉', '🔥']);
  });
});

describe('resolveEmoji', () => {
  it('resolves canonical github shortcodes', () => {
    expect(resolveEmoji(':heart:')).toBe('❤️');
    expect(resolveEmoji(':fire:')).toBe('🔥');
    expect(resolveEmoji(':tada:')).toBe('🎉');
    expect(resolveEmoji(':cry:')).toBe('😢');
    expect(resolveEmoji(':sob:')).toBe('😭');
    expect(resolveEmoji(':joy:')).toBe('😂');
    expect(resolveEmoji(':100:')).toBe('💯');
  });

  it('is case insensitive', () => {
    expect(resolveEmoji(':TADA:')).toBe('🎉');
  });

  it('returns undefined for unknown names', () => {
    expect(resolveEmoji(':notanemoji:')).toBeUndefined();
  });

  // Reactions group by exact string equality, so the picker must emit forms
  // byte-identical to the quick-reaction literals hardcoded across the app.
  // Explicit escapes pin the canonical Unicode forms: no FE0F on thumbs
  // up/down and check mark, FE0F required on red heart.
  it('emits byte forms matching the hardcoded quick-reaction emojis', () => {
    expect(resolveEmoji(':heart:')).toBe('❤️');
    expect(resolveEmoji(':+1:')).toBe('\u{1f44d}');
    expect(resolveEmoji(':-1:')).toBe('\u{1f44e}');
    expect(resolveEmoji(':joy:')).toBe('\u{1f602}');
    expect(resolveEmoji(':rage:')).toBe('\u{1f621}');
    expect(resolveEmoji(':white_check_mark:')).toBe('✅');
  });
});
