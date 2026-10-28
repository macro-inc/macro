import { describe, expect, it } from 'vitest';
import {
  resolveAppearance,
  strokeDasharray,
  validAppearance,
} from '../src/core/appearance';

describe('stroke patterns', () => {
  const base = { fill: 'transparent', stroke: '#123456', strokeWidth: 3 };
  it('keeps existing documents solid and scales dash spacing with stroke weight', () => {
    expect(resolveAppearance(base).strokeStyle).toBe('solid');
    expect(strokeDasharray(base)).toBeUndefined();
    expect(strokeDasharray({ ...base, strokeStyle: 'dashed' })).toBe('12 9');
    expect(strokeDasharray({ ...base, strokeStyle: 'dotted' })).toBe('0 7.5');
  });
  it('accepts persisted patterns and rejects invalid values', () => {
    for (const strokeStyle of ['solid', 'dashed', 'dotted']) {
      expect(validAppearance({ ...base, strokeStyle })).toBe(true);
    }
    expect(validAppearance({ ...base, strokeStyle: 'invalid' })).toBe(false);
  });
});
