import { describe, expect, it } from 'vitest';

import { findNextAutoLinkMatch, normalizeLinkUrl } from './linksPlugin';

describe('normalizeLinkUrl', () => {
  it('normalizes bare hosts to HTTPS', () => {
    expect(normalizeLinkUrl(' example.com/path with spaces ')).toBe(
      'https://example.com/path%20with%20spaces'
    );
  });

  it('allows HTTP, HTTPS, and mailto links', () => {
    expect(normalizeLinkUrl('http://example.com/path')).toBe(
      'http://example.com/path'
    );
    expect(normalizeLinkUrl('https://example.com/path')).toBe(
      'https://example.com/path'
    );
    expect(normalizeLinkUrl('mailto:user@example.com')).toBe(
      'mailto:user@example.com'
    );
  });

  it.each([
    'javascript://alert(1)',
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,unsafe',
    'file:///tmp/secret',
    'ftp://example.com',
  ])('rejects a disallowed URL scheme: %s', (url) => {
    expect(normalizeLinkUrl(url)).toBeNull();
  });

  it('rejects empty and malformed URLs', () => {
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('https://')).toBeNull();
  });
});

describe('findNextAutoLinkMatch', () => {
  it('requires a protocol in protocol mode', () => {
    expect(findNextAutoLinkMatch('Visit example.com')).toBeNull();
    expect(findNextAutoLinkMatch('Visit https://example.rs')?.url).toBe(
      'https://example.rs'
    );
  });

  it('matches common bare TLDs in common-tlds mode', () => {
    expect(findNextAutoLinkMatch('Visit example.com', 'common-tlds')?.url).toBe(
      'https://example.com'
    );
    expect(findNextAutoLinkMatch('Visit macro.co', 'common-tlds')?.url).toBe(
      'https://macro.co'
    );
    expect(findNextAutoLinkMatch('Visit example.org', 'common-tlds')?.url).toBe(
      'https://example.org'
    );
  });

  it('does not match file-like non-curated TLDs in common-tlds mode', () => {
    expect(findNextAutoLinkMatch('Open main.rs', 'common-tlds')).toBeNull();
    expect(findNextAutoLinkMatch('Open parser.ts', 'common-tlds')).toBeNull();
    expect(findNextAutoLinkMatch('Open types.d.ts', 'common-tlds')).toBeNull();
  });

  it('keeps fuzzy mode available for callers that want broader matching', () => {
    expect(findNextAutoLinkMatch('Visit example.rs', 'fuzzy')?.url).toBe(
      'https://example.rs'
    );
  });
});
