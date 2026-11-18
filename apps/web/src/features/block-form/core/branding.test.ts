import { describe, expect, it } from 'vitest';
import { accentContrast, brandingStyle } from './branding';

describe('accentContrast', () => {
  it('writes white on dark accents and black on light ones', () => {
    expect(accentContrast('#1f6feb')).toBe('#ffffff');
    expect(accentContrast('#000000')).toBe('#ffffff');
    expect(accentContrast('#7a1fa2')).toBe('#ffffff');
    expect(accentContrast('#ffd400')).toBe('#000000');
    expect(accentContrast('#ffffff')).toBe('#000000');
    expect(accentContrast('#7fdbca')).toBe('#000000');
  });
});

describe('brandingStyle', () => {
  it('sets nothing without an accent, so the page keeps Macro’s colors', () => {
    expect(brandingStyle(null)).toBeUndefined();
  });

  it('hands the page its accent, the ink that reads on it, and a shade away from that ink', () => {
    expect(brandingStyle('#ffd400')).toEqual({
      '--form-accent': '#ffd400',
      '--form-accent-contrast': '#000000',
      '--form-accent-shade': '#ffffff',
    });
    expect(brandingStyle('#1f6feb')).toEqual({
      '--form-accent': '#1f6feb',
      '--form-accent-contrast': '#ffffff',
      '--form-accent-shade': '#000000',
    });
  });
});
