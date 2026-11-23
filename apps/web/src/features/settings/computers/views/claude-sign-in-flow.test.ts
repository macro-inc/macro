import { describe, expect, it } from 'vitest';
import { isHttpsUrl } from './claude-sign-in-flow';

describe('isHttpsUrl', () => {
  it('opens only https sign-in links', () => {
    expect(
      isHttpsUrl('https://claude.com/cai/oauth/authorize?code=true&state=abc')
    ).toBe(true);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('http://claude.com/cai/oauth/authorize')).toBe(false);
    expect(isHttpsUrl('data:text/html,hi')).toBe(false);
    expect(isHttpsUrl('not a url')).toBe(false);
  });
});
