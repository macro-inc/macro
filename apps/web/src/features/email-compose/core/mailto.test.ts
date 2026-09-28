import { describe, expect, it } from 'vitest';
import { parseMailto } from './mailto';

describe('parseMailto', () => {
  it('parses a single recipient', () => {
    expect(parseMailto('mailto:alice@example.com')).toEqual({
      to: ['alice@example.com'],
    });
  });

  it('parses comma-separated recipients', () => {
    expect(parseMailto('mailto:alice@example.com,bob@example.com')).toEqual({
      to: ['alice@example.com', 'bob@example.com'],
    });
  });

  it('decodes percent-encoded addresses', () => {
    expect(parseMailto('mailto:alice%40example.com')).toEqual({
      to: ['alice@example.com'],
    });
  });

  it('merges the non-standard ?to= param', () => {
    expect(parseMailto('mailto:alice@example.com?to=bob@example.com')).toEqual({
      to: ['alice@example.com', 'bob@example.com'],
    });
  });

  it('handles an empty address (bare mailto:)', () => {
    expect(parseMailto('mailto:')).toEqual({ to: [] });
  });

  it('ignores other query params', () => {
    expect(
      parseMailto('mailto:alice@example.com?subject=Hi&body=Hello')
    ).toEqual({ to: ['alice@example.com'] });
  });

  it('returns null for non-mailto URLs', () => {
    expect(parseMailto('https://example.com')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(parseMailto('not a url')).toBeNull();
  });
});
