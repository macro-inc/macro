import { describe, expect, it } from 'vitest';
import { afterOnboardingTarget, sanitizeNext } from './next-target';

describe('sanitizeNext', () => {
  it.each([
    ['/channel/abc', '/channel/abc'],
    ['/md/1?x=2', '/md/1?x=2'],
    ['//evil.com', undefined],
    ['https://evil.com', undefined],
    ['/a\\b', undefined],
    ['/home', undefined],
    ['/home/inbox', undefined],
    [undefined, undefined],
    [['/channel/abc'], undefined],
  ])('%o → %o', (value, expected) => {
    expect(sanitizeNext(value)).toBe(expected);
  });
});

describe('afterOnboardingTarget', () => {
  it('prefers the first valid deep link', () => {
    expect(afterOnboardingTarget('/home', '/channel/x', '/md/y')).toBe(
      '/channel/x'
    );
  });

  it('falls back to Getting Started', () => {
    expect(afterOnboardingTarget(undefined, '//evil.com')).toBe(
      '/getting-started'
    );
  });
});
