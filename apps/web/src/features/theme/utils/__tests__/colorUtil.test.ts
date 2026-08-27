import { describe, expect, it } from 'vitest';
import {
  convertOklchTo,
  formatOklch,
  getOklch,
  sanitizeOklch,
  tryGetOklch,
} from '../colorUtil';

describe('OKLCH runtime safety', () => {
  it('replaces missing and non-finite channels with finite defaults', () => {
    expect(
      sanitizeOklch({
        l: undefined,
        c: Number.NaN,
        h: undefined,
        alpha: Infinity,
      })
    ).toEqual({ l: 0, c: 0, h: 0, alpha: 1 });
  });

  it('never serializes undefined or NaN channels', () => {
    const value = formatOklch({
      l: undefined,
      c: Number.NaN,
      h: undefined,
      alpha: undefined,
    });

    expect(value).toBe('oklch(0 0 0deg / 1)');
    expect(value).not.toMatch(/undefined|NaN/);
  });

  it('defends Color.js conversion against invalid runtime arguments', () => {
    const value = convertOklchTo(
      undefined as unknown as number,
      Number.NaN,
      undefined as unknown as number,
      'oklch',
      undefined
    );

    expect(value).not.toMatch(/undefined|NaN|none/);
    expect(() => getOklch(value)).not.toThrow();
  });

  it('returns a finite fallback for malformed and unresolved CSS colors', () => {
    const fallback = { l: 0.5, c: 0.1, h: 120, alpha: 0.8 };

    expect(tryGetOklch('var(--missing-color)', fallback)).toEqual(fallback);
    expect(tryGetOklch('oklch(undefined 0.2 30deg)', fallback)).toEqual(
      fallback
    );
    expect(tryGetOklch(undefined, fallback)).toEqual(fallback);
  });
});
