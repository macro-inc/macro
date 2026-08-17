import { DEFAULT_THEMES } from '@theme/constants';
import { inputColorTokens, semanticTokens } from '@theme/types/themeTypes';
import {
  isThemeV2,
  isThemeV3,
  parseThemeV2Json,
  parseThemeV3Json,
} from '@theme/utils/themeValidation';
import { describe, expect, it } from 'vitest';

const validThemeJson = JSON.stringify({
  id: 'test-theme-id',
  name: 'dryblood',
  version: 2,
  depth: 0.15,
  tokens: {
    a0: { l: 0.7, c: 0.15, h: 30 },
    a1: { l: 0.6, c: 0.12, h: 30 },
    a2: { l: 0.5, c: 0.1, h: 30 },
    a3: { l: 0.4, c: 0.08, h: 30 },
    a4: { l: 0.3, c: 0.06, h: 30 },
    b0: { l: 0.2, c: 0.02, h: 300 },
    b1: { l: 0.25, c: 0.02, h: 300 },
    b2: { l: 0.15, c: 0.02, h: 300 },
    b3: { l: 0.1, c: 0.02, h: 300 },
    b4: { l: 0.05, c: 0.02, h: 300 },
    c0: { l: 0.9, c: 0.02, h: 300 },
    c1: { l: 0.8, c: 0.02, h: 300 },
    c2: { l: 0.7, c: 0.02, h: 300 },
    c3: { l: 0.6, c: 0.02, h: 300 },
    c4: { l: 0.5, c: 0.02, h: 300 },
  },
});

const validV3Theme = {
  id: 'token-only-theme',
  name: 'Token only',
  version: 3,
  mode: 'light',
  colorTokens: Object.fromEntries(
    [...inputColorTokens, ...semanticTokens].map((token) => [
      token,
      token === 'hover'
        ? 'color-mix(in oklch, var(--color-content-0) 3%, transparent)'
        : `var(--test-${token})`,
    ])
  ),
};

describe('parseThemeV2Json', () => {
  it('returns parsed ThemeV2 for valid theme JSON', () => {
    const result = parseThemeV2Json(validThemeJson);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('test-theme-id');
    expect(result!.name).toBe('dryblood');
    expect(result!.version).toBe(2);
    expect(result!.depth).toBe(0.15);
    expect(result!.tokens.a0).toEqual({ l: 0.7, c: 0.15, h: 30 });
  });

  it('returns null for invalid JSON', () => {
    expect(parseThemeV2Json('not json')).toBeNull();
  });

  it('returns null for JSON missing id', () => {
    const json = JSON.parse(validThemeJson);
    delete json.id;
    expect(parseThemeV2Json(JSON.stringify(json))).toBeNull();
  });

  it('returns null for JSON missing name', () => {
    const json = JSON.parse(validThemeJson);
    delete json.name;
    expect(parseThemeV2Json(JSON.stringify(json))).toBeNull();
  });

  it('returns null for JSON missing version', () => {
    const json = JSON.parse(validThemeJson);
    delete json.version;
    expect(parseThemeV2Json(JSON.stringify(json))).toBeNull();
  });

  it('returns null for JSON missing depth', () => {
    const json = JSON.parse(validThemeJson);
    delete json.depth;
    expect(parseThemeV2Json(JSON.stringify(json))).toBeNull();
  });

  it('returns null for JSON missing tokens', () => {
    const json = JSON.parse(validThemeJson);
    delete json.tokens;
    expect(parseThemeV2Json(JSON.stringify(json))).toBeNull();
  });

  it('returns null for JSON with incomplete tokens (missing a token key)', () => {
    const json = JSON.parse(validThemeJson);
    delete json.tokens.c4;
    expect(parseThemeV2Json(JSON.stringify(json))).toBeNull();
  });

  it('returns null for JSON with invalid token value (missing l)', () => {
    const json = JSON.parse(validThemeJson);
    json.tokens.a0 = { c: 0.15, h: 30 };
    expect(parseThemeV2Json(JSON.stringify(json))).toBeNull();
  });

  it('returns null for JSON with non-number token value', () => {
    const json = JSON.parse(validThemeJson);
    json.tokens.a0 = { l: 'not a number', c: 0.15, h: 30 };
    expect(parseThemeV2Json(JSON.stringify(json))).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseThemeV2Json('')).toBeNull();
  });

  it('returns null for a plain URL', () => {
    expect(parseThemeV2Json('https://example.com')).toBeNull();
  });

  it('returns null for an array', () => {
    expect(parseThemeV2Json('[]')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseThemeV2Json('null')).toBeNull();
  });
});

describe('isThemeV2', () => {
  it('returns true for a valid ThemeV2 object', () => {
    const data = JSON.parse(validThemeJson);
    expect(isThemeV2(data)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isThemeV2(null)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isThemeV2('not an object')).toBe(false);
  });

  it('returns false for an object missing tokens', () => {
    const data = JSON.parse(validThemeJson);
    delete data.tokens;
    expect(isThemeV2(data)).toBe(false);
  });

  it('returns false for an object missing depth', () => {
    const data = JSON.parse(validThemeJson);
    delete data.depth;
    expect(isThemeV2(data)).toBe(false);
  });

  it('accepts flat VNext color tokens', () => {
    const data = JSON.parse(validThemeJson);
    data.colorTokens = {
      'surface-0': '#000000',
      chrome: 'var(--color-surface-4)',
    };
    expect(isThemeV2(data)).toBe(true);
  });

  it('rejects non-string VNext color token values', () => {
    const data = JSON.parse(validThemeJson);
    data.colorTokens = { accent: 42 };
    expect(isThemeV2(data)).toBe(false);
  });

  it('rejects a V3 version number even when legacy fields are present', () => {
    const data = JSON.parse(validThemeJson);
    data.version = 3;
    expect(isThemeV2(data)).toBe(false);
  });
});

describe('token-only ThemeV3 validation', () => {
  it('accepts a V3 theme containing only required raw input tokens', () => {
    const inputOnlyTheme = structuredClone(validV3Theme);
    for (const token of semanticTokens) {
      delete inputOnlyTheme.colorTokens[token];
    }

    expect(isThemeV3(inputOnlyTheme)).toBe(true);
    expect(parseThemeV3Json(JSON.stringify(inputOnlyTheme))).toEqual(
      inputOnlyTheme
    );
  });

  it('accepts a complete V3 theme without legacy tokens or depth', () => {
    expect(isThemeV3(validV3Theme)).toBe(true);
    expect(parseThemeV3Json(JSON.stringify(validV3Theme))).toEqual(
      validV3Theme
    );
  });

  it('requires an explicit light or dark mode', () => {
    expect(isThemeV3({ ...validV3Theme, mode: 'system' })).toBe(false);
  });

  it('rejects a missing required raw input token', () => {
    const colorTokens = { ...validV3Theme.colorTokens };
    delete colorTokens['surface-4'];
    expect(isThemeV3({ ...validV3Theme, colorTokens })).toBe(false);
  });

  it('rejects empty and non-string token values', () => {
    expect(
      isThemeV3({
        ...validV3Theme,
        colorTokens: { ...validV3Theme.colorTokens, accent: '' },
      })
    ).toBe(false);
    expect(
      isThemeV3({
        ...validV3Theme,
        colorTokens: { ...validV3Theme.colorTokens, accent: 42 },
      })
    ).toBe(false);
  });

  it('exports every built-in theme in token-only V3 form', () => {
    for (const theme of DEFAULT_THEMES) {
      expect(isThemeV3(theme)).toBe(true);
      expect(theme.version).toBe(3);
      expect(theme).not.toHaveProperty('tokens');
      expect(theme).not.toHaveProperty('depth');
    }
  });
});
