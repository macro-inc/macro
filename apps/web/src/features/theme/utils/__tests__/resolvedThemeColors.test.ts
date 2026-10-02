import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_THEMES } from '../../constants';
import { resolveThemeColors } from '../resolvedThemeColors';

describe('resolved theme colors', () => {
  it('normalizes valid hue angles without clamping their color', () => {
    const colors = resolveThemeColors(
      {
        accent: 'oklch(0.6 0.2 -30)',
        'content-0': 'oklch(0.7 0.1 810)',
      },
      'dark'
    );
    expect(colors.accent.h).toBe(330);
    expect(colors['content-0'].h).toBe(90);
  });

  it('falls back for invalid mix percentages', () => {
    const colors = resolveThemeColors(
      {
        accent:
          'color-mix(in oklch, var(--color-content-0) 150%, var(--color-surface-0))',
      },
      'dark'
    );
    expect(colors.accent).toEqual(resolveThemeColors({}, 'dark').accent);
  });

  it('resolves every built-in palette without creating DOM probes', () => {
    const create = vi.spyOn(document, 'createElement');
    for (const theme of DEFAULT_THEMES) {
      const colors = resolveThemeColors(theme.colorTokens, theme.mode);
      for (const color of Object.values(colors)) {
        expect(Object.values(color).every(Number.isFinite)).toBe(true);
      }
    }
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('reuses equal graphs and invalidates linked and mixed colors on edits', () => {
    const tokens = {
      accent: 'var(--color-source)',
      source: 'oklch(0.6 0.2 30)',
      'surface-1':
        'color-mix(in oklch, var(--color-source) 25%, var(--color-other))',
      other: 'oklch(0.2 0.1 70)',
    };
    const first = resolveThemeColors(tokens, 'dark');
    expect(resolveThemeColors({ ...tokens }, 'dark')).toBe(first);
    expect(first.accent.l).toBeCloseTo(0.6);
    expect(first['surface-1'].l).toBeCloseTo(0.3);
    const edited = resolveThemeColors(
      { ...tokens, source: 'oklch(0.8 0.2 30)' },
      'dark'
    );
    expect(edited.accent.l).toBeCloseTo(0.8);
    expect(edited['surface-1'].l).toBeCloseTo(0.35);
    expect(first.accent.l).toBeCloseTo(0.6);
  });

  it('mixes alpha without premultiplying hue and preserves linked transparency', () => {
    const colors = resolveThemeColors(
      {
        a: 'oklch(0.8 0.2 350 / 0.5)',
        b: 'oklch(0.2 0.1 10)',
        accent: 'color-mix(in oklch, var(--color-a) 50%, var(--color-b))',
        'content-0': 'color-mix(in oklch, var(--color-a) 20%, transparent)',
      },
      'dark'
    );
    expect(colors.accent).toMatchObject({ alpha: 0.75, h: 0 });
    expect(colors.accent.l).toBeCloseTo(0.4);
    expect(colors['content-0'].alpha).toBeCloseTo(0.1);
  });

  it('ignores powerless hue in neutral endpoints', () => {
    const colors = resolveThemeColors(
      {
        a: 'oklch(0.2 0 0)',
        b: 'oklch(0.8 0.2 100)',
        accent: 'color-mix(in oklch, var(--color-a) 50%, var(--color-b))',
      },
      'dark'
    );
    expect(colors.accent.h).toBeCloseTo(100);
    expect(colors.accent.c).toBeCloseTo(0.1);
  });

  it('terminates cyclic references and falls back to finite colors', () => {
    const colors = resolveThemeColors(
      { accent: 'var(--color-loop)', loop: 'var(--color-accent)' },
      'dark'
    );
    expect(Object.values(colors.accent).every(Number.isFinite)).toBe(true);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
