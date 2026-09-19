import {
  inputColorTokens,
  type ThemeV2,
  type ThemeV2Tokens,
  type ThemeV3,
} from '../types/themeTypes';

const THEME_V2_TOKEN_KEYS: ReadonlyArray<keyof ThemeV2Tokens> = [
  'a0',
  'a1',
  'a2',
  'a3',
  'a4',
  'b0',
  'b1',
  'b2',
  'b3',
  'b4',
  'c0',
  'c1',
  'c2',
  'c3',
  'c4',
];

function isTokenValue(
  val: unknown
): val is { l: number; c: number; h: number } {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.l === 'number' &&
    typeof obj.c === 'number' &&
    typeof obj.h === 'number'
  );
}

export function isThemeV2(data: unknown): data is ThemeV2 {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string') return false;
  if (typeof obj.name !== 'string') return false;
  if (obj.version !== 2) return false;
  if (typeof obj.depth !== 'number') return false;
  if (typeof obj.tokens !== 'object' || obj.tokens === null) return false;

  const tokens = obj.tokens as Record<string, unknown>;
  for (const key of THEME_V2_TOKEN_KEYS) {
    if (!isTokenValue(tokens[key])) return false;
  }

  if (obj.colorTokens !== undefined) {
    if (typeof obj.colorTokens !== 'object' || obj.colorTokens === null) {
      return false;
    }
    if (
      !Object.values(obj.colorTokens as Record<string, unknown>).every(
        (value) => typeof value === 'string'
      )
    ) {
      return false;
    }
  }

  return true;
}

/** Validates the token-only persisted theme format. Raw input colors are the
 * only required authored values. Semantic and extension tokens are optional
 * overrides and are filled from the central defaults when the theme loads. */
export function isThemeV3(data: unknown): data is ThemeV3 {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string') return false;
  if (typeof obj.name !== 'string') return false;
  if (obj.version !== 3) return false;
  if (obj.mode !== 'light' && obj.mode !== 'dark') return false;
  if (typeof obj.colorTokens !== 'object' || obj.colorTokens === null) {
    return false;
  }

  const colorTokens = obj.colorTokens as Record<string, unknown>;
  if (
    !Object.values(colorTokens).every(
      (value) => typeof value === 'string' && value.trim().length > 0
    )
  ) {
    return false;
  }

  return inputColorTokens.every(
    (token) => typeof colorTokens[token] === 'string'
  );
}

export function parseThemeV2Json(text: string): ThemeV2 | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isThemeV2(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function parseThemeV3Json(text: string): ThemeV3 | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isThemeV3(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
