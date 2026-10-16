import { describe, expect, it } from 'vitest';
import { allOf, flagVerdict } from './verdict';

describe('allOf', () => {
  it('is false once any part is false, even while others load', () => {
    expect(allOf(true, undefined, false)).toBe(false);
  });

  it('waits on any unknown part, then is true', () => {
    expect(allOf(true, undefined)).toBeUndefined();
    expect(allOf(true, true)).toBe(true);
    expect(allOf()).toBe(true);
  });
});

describe('flagVerdict', () => {
  it('is unknown until the flag has loaded', () => {
    expect(flagVerdict({ enabled: false, loading: true })).toBeUndefined();
    expect(flagVerdict({ enabled: false, loading: false })).toBe(false);
    expect(flagVerdict({ enabled: true, loading: false })).toBe(true);
  });
});
