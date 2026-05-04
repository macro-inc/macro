import { describe, expect, it } from 'vitest';
import {
  isThemeV2,
  parseThemeV2Json,
} from '@theme/utils/themeValidation';

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
});
