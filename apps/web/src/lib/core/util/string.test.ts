import { describe, expect, it } from 'vitest';
import { isEmojiOnly } from './string';

describe('isEmojiOnly', () => {
  it('returns true for single emoji', () => {
    expect(isEmojiOnly('🎉')).toBe(true);
    expect(isEmojiOnly('👍')).toBe(true);
    expect(isEmojiOnly('❤️')).toBe(true);
  });

  it('returns true for multiple emojis', () => {
    expect(isEmojiOnly('🎉🎊🎈')).toBe(true);
    expect(isEmojiOnly('👍👍👍')).toBe(true);
  });

  it('returns true for emojis with spaces', () => {
    expect(isEmojiOnly('🎉 🎊 🎈')).toBe(true);
    expect(isEmojiOnly('  🎉  ')).toBe(true);
  });

  it('returns true for composite emojis (ZWJ sequences)', () => {
    expect(isEmojiOnly('👨‍👩‍👧‍👦')).toBe(true); // family emoji
    expect(isEmojiOnly('👩‍💻')).toBe(true); // woman technologist
  });

  it('returns true for flag emojis', () => {
    expect(isEmojiOnly('🇺🇸')).toBe(true);
    expect(isEmojiOnly('🇬🇧')).toBe(true);
  });

  it('returns true for skin tone variants', () => {
    expect(isEmojiOnly('👍🏻')).toBe(true);
    expect(isEmojiOnly('👍🏿')).toBe(true);
  });

  it('returns false for text with emojis', () => {
    expect(isEmojiOnly('Hello 👋')).toBe(false);
    expect(isEmojiOnly('🎉 party!')).toBe(false);
    expect(isEmojiOnly('Great job 👍')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(isEmojiOnly('Hello')).toBe(false);
    expect(isEmojiOnly('hello world')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isEmojiOnly('')).toBe(false);
    expect(isEmojiOnly('   ')).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(isEmojiOnly('123')).toBe(false);
    expect(isEmojiOnly('🎉 123')).toBe(false);
  });

  it('returns false for punctuation', () => {
    expect(isEmojiOnly('!')).toBe(false);
    expect(isEmojiOnly('🎉!')).toBe(false);
  });
});
