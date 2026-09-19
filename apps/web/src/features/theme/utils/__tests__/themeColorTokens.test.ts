import { describe, expect, it } from 'vitest';
import { semanticTokens, type ThemeV2Tokens } from '../../types/themeTypes';
import {
  parseThemeAssignment,
  serializeThemeAssignment,
} from '../themeAssignments';
import {
  getDefaultSemanticColorTokens,
  legacyThemeToVNextTokens,
  normalizeThemeColorTokens,
} from '../themeColorTokens';
import { convertThemev2v3 } from '../themeMigrations';

const legacyTokens: ThemeV2Tokens = {
  a0: { l: 0.7, c: 0.2, h: 40 },
  a1: { l: 0.7, c: 0.2, h: 80 },
  a2: { l: 0.7, c: 0.2, h: 120 },
  a3: { l: 0.7, c: 0.2, h: 160 },
  a4: { l: 0.7, c: 0.2, h: 200 },
  b0: { l: 0.1, c: 0, h: 0 },
  b1: { l: 0.2, c: 0, h: 0 },
  b2: { l: 0.3, c: 0, h: 0 },
  b3: { l: 0.4, c: 0, h: 0 },
  b4: { l: 0.5, c: 0, h: 0 },
  c0: { l: 0.95, c: 0, h: 0 },
  c1: { l: 0.85, c: 0, h: 0 },
  c2: { l: 0.75, c: 0, h: 0 },
  c3: { l: 0.65, c: 0, h: 0 },
  c4: { l: 0.55, c: 0, h: 0 },
};

describe('legacyThemeToVNextTokens', () => {
  it('fills semantic defaults and removes retired tokens from V3 token maps', () => {
    const result = normalizeThemeColorTokens(
      {
        'surface-4': '#fff',
        'surface-5': '#eee',
        'edge-subtle': '#ddd',
        lift: '#ccc',
        extension: '#000',
      },
      'dark'
    );

    expect(result).toMatchObject({
      'surface-4': '#fff',
      extension: '#000',
      tooltip: 'var(--color-surface-2)',
      toast: 'var(--color-surface-2)',
      link: 'var(--color-accent)',
      'link-hover': 'var(--color-accent)',
      'link-visited': 'var(--color-accent)',
    });
    expect(result['surface-5']).toBeUndefined();
    expect(result['edge-subtle']).toBeUndefined();
    expect(result.lift).toBeUndefined();
  });

  it('centralizes a default for every semantic token', () => {
    const defaults = getDefaultSemanticColorTokens('dark');
    expect(Object.keys(defaults)).toEqual([...semanticTokens]);
    expect(defaults).toMatchObject({
      surface: 'var(--layer-surface)',
      panel: 'var(--color-surface-1)',
      warning: 'var(--color-amber)',
      message: 'var(--color-surface-1)',
    });
    expect(getDefaultSemanticColorTokens('light').warning).toBe(
      'var(--color-yellow)'
    );
  });

  it('builds the final input and semantic registry', () => {
    const result = legacyThemeToVNextTokens({ tokens: legacyTokens }, 'dark');

    expect(result['surface-0']).toBe('oklch(0.1 0 0deg)');
    expect(result['surface-4']).toBe('oklch(0.5 0 0deg)');
    expect(result['content-4']).toBe('oklch(0.55 0 0deg)');
    expect(result['content-5']).toBeUndefined();
    expect(result['edge-subtle']).toBeUndefined();
    expect(result.chrome).toBe('var(--color-surface-4)');
    expect(result.surface).toBe('var(--layer-surface)');
    expect(result.inset).toBe('var(--layer-inset)');
    expect(result.lift).toBeUndefined();
    expect(result.panel).toBe('var(--color-surface-1)');
    expect(result.tooltip).toBe('var(--color-surface-2)');
    expect(result.toast).toBe('var(--color-surface-2)');
    expect(result.link).toBe('var(--color-accent)');
    expect(result['link-hover']).toBe('var(--color-accent)');
    expect(result['link-visited']).toBe('var(--color-accent)');
    expect(result.hover).toBe(
      'color-mix(in oklch, var(--color-content-0) 3%, transparent)'
    );
    expect(result.active).toBe(
      'color-mix(in oklch, var(--color-content-0) 6%, transparent)'
    );
    expect(result.warning).toBe('var(--color-amber)');
    expect(result.red).toBe('oklch(0.7 0.2 25.331deg)');
    expect(result.yellow).toBe('oklch(0.7 0.2 86.047deg)');
    expect(result.pink).toBe('oklch(0.7 0.2 354.308deg)');
  });

  it('converts inverted legacy light surfaces into a rising ramp', () => {
    const result = legacyThemeToVNextTokens(
      {
        tokens: {
          ...legacyTokens,
          b0: { l: 0.96, c: 0.01, h: 60 },
          b1: { l: 0.92, c: 0.01, h: 60 },
          b2: { l: 0.91, c: 0.01, h: 60 },
          b3: { l: 0.9, c: 0.01, h: 60 },
          b4: { l: 0.89, c: 0.01, h: 60 },
        },
      },
      'light'
    );

    expect(result['surface-0']).toBe('oklch(0.96 0.01 60deg)');
    expect(result['surface-1']).toBe('oklch(0.97 0.0075 60deg)');
    expect(result['surface-4']).toBe('oklch(1 0 60deg)');
    expect(result.edge).toBe('oklch(0.89 0.01 60deg)');
  });

  it('rounds every numeric OKLCH component to at most eight decimals', () => {
    const result = legacyThemeToVNextTokens(
      {
        tokens: {
          ...legacyTokens,
          a0: { l: 0.6789, c: 0.1234, h: 42.678 },
          c0: { l: 0.9345, c: 0.0123, h: 12.345 },
        },
        overrides: [
          {
            token: 'panel',
            value: { l: 0.8765, c: 0.0345, h: 123.456 },
          },
        ],
      },
      'dark'
    );

    expect(result.accent).toBe('oklch(0.6789 0.1234 42.678deg)');
    expect(result['content-0']).toBe('oklch(0.9345 0.0123 12.345deg)');
    expect(result.red).toBe('oklch(0.6789 0.1234 25.331deg)');
    expect(result.panel).toBe('oklch(0.8765 0.0345 123.456deg)');
  });
});

describe('theme assignment serialization', () => {
  it('round trips a linked token with alpha', () => {
    const value = serializeThemeAssignment({
      kind: 'linked',
      token: 'accent',
      alpha: 0.08,
    });

    expect(parseThemeAssignment(value)).toEqual({
      kind: 'linked',
      token: 'accent',
      alpha: 0.08,
    });
  });

  it('round trips a mixed token with alpha', () => {
    const assignment = {
      kind: 'mixed' as const,
      first: 'content-0',
      second: 'surface-0',
      mix: 0.35,
      alpha: 0.6,
    };

    expect(parseThemeAssignment(serializeThemeAssignment(assignment))).toEqual(
      assignment
    );
  });

  it('round trips an sRGB ramp mix', () => {
    const assignment = {
      kind: 'mixed' as const,
      first: 'surface-0',
      second: 'surface-4',
      mix: 0.75,
      alpha: 1,
      space: 'srgb' as const,
    };

    expect(serializeThemeAssignment(assignment)).toBe(
      'color-mix(in srgb, var(--color-surface-0) 75%, var(--color-surface-4))'
    );
    expect(parseThemeAssignment(serializeThemeAssignment(assignment))).toEqual(
      assignment
    );
  });
});

describe('ThemeV2 to ThemeV3 migration', () => {
  it('produces a token-only theme with an explicit mode', () => {
    const result = convertThemev2v3({
      id: 'legacy',
      name: 'Legacy',
      version: 2,
      depth: 0.15,
      tokens: legacyTokens,
    });

    expect(result.version).toBe(3);
    expect(result.mode).toBe('dark');
    expect(result.colorTokens['surface-0']).toBe('oklch(0.1 0 0deg)');
    expect(result).not.toHaveProperty('tokens');
    expect(result).not.toHaveProperty('depth');
  });

  it('fills a partial experimental color registry during migration', () => {
    const result = convertThemev2v3({
      id: 'partial',
      name: 'Partial',
      version: 2,
      depth: 0.15,
      tokens: legacyTokens,
      colorTokens: { accent: '#ff0000' },
    });

    expect(result.colorTokens.accent).toBe('#ff0000');
    expect(result.colorTokens['surface-0']).toBe('oklch(0.1 0 0deg)');
    expect(result.colorTokens.ink).toBe('var(--color-content-0)');
  });
});
