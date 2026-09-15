import { describe, expect, it } from 'vitest';
import { supportedThemeId } from '../supportedTheme';

describe('retired theme selections', () => {
  it.each(['Macro Light', 'Satsuma', 'Lapis', 'Flora', 'Paper', 'Decepticon'])(
    'keeps %s in light mode',
    (id) => expect(supportedThemeId(id)).toBe('Macro Light')
  );
  it.each([
    'Macro Dark',
    'Macro Gruvbox',
    'Void',
    'Ember',
    'Spirit',
    'Moon',
    'Rain',
    'missing-id',
  ])('maps %s to the maintained dark theme', (id) =>
    expect(supportedThemeId(id)).toBe('Macro Dark')
  );
  it('preserves a custom theme’s mode without making it selectable', () => {
    const saved = [
      { id: 'custom-light', mode: 'light' as const },
      { id: 'custom-dark', mode: 'dark' as const },
    ];
    expect(supportedThemeId('custom-light', saved)).toBe('Macro Light');
    expect(supportedThemeId('custom-dark', saved)).toBe('Macro Dark');
    expect(saved).toHaveLength(2);
  });
});
