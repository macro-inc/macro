import { describe, expect, it } from 'vitest';
import { isQuoteReplyMarkdown } from '../utils/quote-reply';

describe('isQuoteReplyMarkdown', () => {
  it('detects a quote followed by a reply', () => {
    expect(isQuoteReplyMarkdown('> can you fix the tests\n\nyes, on it')).toBe(
      true
    );
  });

  it('detects a multi-line quote', () => {
    expect(
      isQuoteReplyMarkdown('> first line\n> second line\n\nlooks right to me')
    ).toBe(true);
  });

  it('rejects plain text', () => {
    expect(isQuoteReplyMarkdown('just a normal message')).toBe(false);
  });

  it('rejects a bare quote with no reply', () => {
    expect(isQuoteReplyMarkdown('> quoted with nothing to say')).toBe(false);
  });

  it('rejects a quote appearing after the reply', () => {
    expect(isQuoteReplyMarkdown('as I said\n\n> earlier message')).toBe(false);
  });

  it('rejects empty markdown', () => {
    expect(isQuoteReplyMarkdown('')).toBe(false);
  });
});
