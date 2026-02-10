import type { ThemeV1, ThemeV1Tokens } from '../types/themeTypes';

const THEME_V1_TOKEN_KEYS: ReadonlyArray<keyof ThemeV1Tokens> = [
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

function isTokenValue(val: unknown): val is { l: number; c: number; h: number } {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.l === 'number' &&
    typeof obj.c === 'number' &&
    typeof obj.h === 'number'
  );
}

export function isThemeV1(data: unknown): data is ThemeV1 {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string') return false;
  if (typeof obj.name !== 'string') return false;
  if (typeof obj.version !== 'number') return false;
  if (typeof obj.tokens !== 'object' || obj.tokens === null) return false;

  const tokens = obj.tokens as Record<string, unknown>;
  for (const key of THEME_V1_TOKEN_KEYS) {
    if (!isTokenValue(tokens[key])) return false;
  }

  return true;
}

export function parseThemeV1Json(text: string): ThemeV1 | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isThemeV1(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}
