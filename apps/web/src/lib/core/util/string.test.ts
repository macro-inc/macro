import { describe, expect, it } from 'vitest';
import { formatOrdinal, isEmojiOnly } from './string';

describe('formatOrdinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [-1, '-1st'],
  ])('formats %d as %s', (value, expected) => {
    expect(formatOrdinal(value)).toBe(expected);
  });
});

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
