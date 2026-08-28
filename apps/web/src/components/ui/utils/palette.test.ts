import { describe, expect, it } from 'vitest';
import { getHashedPaletteColor, PALETTE_COLORS } from './palette';

describe('getHashedPaletteColor', () => {
  it('keeps the default palette mapping stable', () => {
    expect(getHashedPaletteColor('document-author-id')).toBe('purple');
    expect(getHashedPaletteColor('another-author-id')).toBe('teal');
  });

  it('supports a typed palette for a specific use case', () => {
    const palette = ['text-success', 'text-failure'] as const;

    expect(getHashedPaletteColor('custom-stage', { palette })).toBe(
      'text-failure'
    );
  });

  it('always returns an authored palette color by default', () => {
    expect(PALETTE_COLORS).toContain(getHashedPaletteColor(''));
  });
});
