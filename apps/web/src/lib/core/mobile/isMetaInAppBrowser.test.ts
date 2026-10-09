import { describe, expect, it } from 'vitest';
import { isMetaAdSearch, isMetaInAppUserAgent } from './isMetaInAppBrowser';

describe('meta in-app browser', () => {
  it('recognizes Instagram and Facebook webviews', () => {
    expect(
      isMetaInAppUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.0.0'
      )
    ).toBe(true);
    expect(
      isMetaInAppUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/400.0.0.0;]'
      )
    ).toBe(true);
    expect(
      isMetaInAppUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe(false);
  });

  it('recognizes Meta ad click parameters', () => {
    expect(isMetaAdSearch('?fbclid=abc')).toBe(true);
    expect(isMetaAdSearch('?utm_source=instagram')).toBe(true);
    expect(isMetaAdSearch('?utm_source=google')).toBe(false);
    expect(isMetaAdSearch('')).toBe(false);
  });
});
