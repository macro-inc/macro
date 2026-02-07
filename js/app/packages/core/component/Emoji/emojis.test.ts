import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  ORDERED_EMOJI_DATA,
  resolveEmoji,
  resolveEmojiFromUnicode,
  useEmojiData,
} from './emojis';

describe('resolveEmojiFromUnicode', () => {
  it('returns known emoji metadata in O(1) lookup path', () => {
    const data = resolveEmojiFromUnicode('😀');
    expect(data).toBeDefined();
    expect(data?.emoji).toBe('😀');
  });

  it('returns undefined for unknown unicode', () => {
    expect(resolveEmojiFromUnicode('not-an-emoji')).toBeUndefined();
  });
});

describe('resolveEmoji', () => {
  it('resolves custom aliases', () => {
    expect(resolveEmoji(':heart:')).toBe(String.fromCodePoint(0x2764, 0xfe0f));
  });

  it('resolves standard terms', () => {
    const firstResolvable = ORDERED_EMOJI_DATA.find(
      (emoji) => emoji.terms.length > 0
    );
    expect(firstResolvable).toBeDefined();
    const primaryTerm = firstResolvable?.terms[0];
    expect(resolveEmoji(`:${primaryTerm}:`)).toBe(firstResolvable?.emoji);
  });

  it('returns undefined for unknown terms', () => {
    expect(resolveEmoji(':definitely-not-real:')).toBeUndefined();
  });
});

describe('useEmojiData', () => {
  it('returns full emoji list for short searches and filters for longer terms', () => {
    createRoot((dispose) => {
      const { emojis, filter } = useEmojiData();

      filter('a');
      expect(emojis().length).toBe(ORDERED_EMOJI_DATA.length);

      filter('grinning');
      expect(emojis().some((emoji) => emoji.emoji === '😀')).toBe(true);

      dispose();
    });
  });
});
