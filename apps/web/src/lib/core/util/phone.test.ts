import { describe, expect, it } from 'vitest';
import { readablePhone } from './phone';

describe('readablePhone', () => {
  it('leaves numbers without a known grouping as stored', () => {
    expect(readablePhone('+1555010')).toBe('+1555010');
    expect(readablePhone('+4420555')).toBe('+4420555');
  });
});
