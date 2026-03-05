import { describe, expect, it } from 'vitest';
import { plainTextToHtml } from './plainTextToHtml';

const span = (text: string) =>
  `<span style="white-space: pre-wrap;">${text}</span>`;

describe('plainTextToHtml', () => {
  it('returns a br for empty string', () => {
    expect(plainTextToHtml('')).toBe('<div><br></div>');
  });

  it('wraps a single line in a span', () => {
    expect(plainTextToHtml('hello')).toBe(`<div>${span('hello')}</div>`);
  });

  it('splits newlines with br separators', () => {
    expect(plainTextToHtml('line1\nline2')).toBe(
      `<div>${span('line1')}<br>${span('line2')}</div>`
    );
  });

  it('handles consecutive newlines as double br', () => {
    expect(plainTextToHtml('above\n\nbelow')).toBe(
      `<div>${span('above')}<br><br><br>${span('below')}</div>`
    );
  });

  it('handles only newlines', () => {
    // '\n\n' splits into ['', '', ''] → <br> joined by <br> = 5 <br>s
    expect(plainTextToHtml('\n\n')).toBe('<div><br><br><br><br><br></div>');
  });

  describe('html escaping', () => {
    it('escapes ampersands', () => {
      expect(plainTextToHtml('a & b')).toBe(`<div>${span('a &amp; b')}</div>`);
    });

    it('escapes angle brackets', () => {
      expect(plainTextToHtml('<script>alert("xss")</script>')).toBe(
        `<div>${span('&lt;script&gt;alert("xss")&lt;/script&gt;')}</div>`
      );
    });
  });

  describe('no markdown formatting applied', () => {
    it('preserves asterisks literally', () => {
      expect(plainTextToHtml('**Key Points:**')).toBe(
        `<div>${span('**Key Points:**')}</div>`
      );
    });

    it('preserves underscores literally', () => {
      expect(plainTextToHtml('file_name_with_underscores')).toBe(
        `<div>${span('file_name_with_underscores')}</div>`
      );
    });

    it('preserves scope names with dots and underscores', () => {
      expect(plainTextToHtml('gmail.settings_basic')).toBe(
        `<div>${span('gmail.settings_basic')}</div>`
      );
    });

    it('preserves math expressions with asterisks', () => {
      expect(plainTextToHtml('3 * 5 = 15')).toBe(
        `<div>${span('3 * 5 = 15')}</div>`
      );
    });
  });

  it('handles multiline content matching editor format', () => {
    const input = 'Hi,\n\nSome text here';
    expect(plainTextToHtml(input)).toBe(
      `<div>${span('Hi,')}<br><br><br>${span('Some text here')}</div>`
    );
  });
});
