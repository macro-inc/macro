import type {
  InputColorToken,
  SemanticToken,
  ThemeColorMode,
  ThemeColorTokens,
  ThemeV2,
  ThemeV2Tokens,
} from '../types/themeTypes';

/** Tailwind 500 hue angles used to project a legacy theme's accent color. */
export const PALETTE_HUES = {
  red: 25.331,
  orange: 47.604,
  amber: 70.08,
  yellow: 86.047,
  lime: 130.85,
  green: 149.579,
  teal: 182.503,
  cyan: 215.221,
  blue: 259.815,
  violet: 292.717,
  purple: 303.9,
  pink: 354.308,
} as const satisfies Record<string, number>;

const roundToEightDecimals = (value: number) => {
  const rounded =
    Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const oklch = (color: { l: number; c: number; h: number }) =>
  `oklch(${roundToEightDecimals(color.l)} ${roundToEightDecimals(color.c)} ${roundToEightDecimals(color.h)}deg)`;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function buildSurfaceRamp(
  tokens: ThemeV2Tokens,
  mode: ThemeColorMode
): string[] {
  const legacy = [tokens.b0, tokens.b1, tokens.b2, tokens.b3, tokens.b4];

  if (mode === 'light') {
    // Legacy light themes expected Layer to raise b0 mathematically, so their
    // authored b1-b4 values often run in the opposite direction. VNext stores
    // the actual layer colors: preserve the base and interpolate toward white.
    return Array.from({ length: 5 }, (_, index) => {
      const progress = index / 4;
      return oklch({
        l: clamp(tokens.b0.l + (1 - tokens.b0.l) * progress),
        c: tokens.b0.c * (1 - progress),
        h: tokens.b0.h,
      });
    });
  }

  // Dark legacy ramps already rise with depth. Guard against any small
  // non-monotonic authored steps.
  let previousLightness = legacy[0]?.l ?? 0;
  return legacy.map((color) => {
    previousLightness = Math.max(previousLightness, color.l);
    return oklch({ ...color, l: previousLightness });
  });
}

export const tokenReference = (token: string) => `var(--color-${token})`;

export const alphaToken = (token: string, alpha: number) =>
  `color-mix(in oklch, ${tokenReference(token)} ${Math.round(alpha * 10000) / 100}%, transparent)`;

export const mixTokens = (
  first: string,
  second: string,
  amount: number,
  space: 'oklch' | 'srgb' = 'oklch'
) =>
  `color-mix(in ${space}, ${tokenReference(first)} ${Math.round(amount * 10000) / 100}%, ${tokenReference(second)})`;

/** The complete default semantic graph. Themes only need to store raw input
 * colors; any entry they author here overrides this CSS-variable assignment. */
export function getDefaultSemanticColorTokens(
  mode: ThemeColorMode
): Record<SemanticToken, string> {
  return {
    surface: 'var(--layer-surface)',
    inset: 'var(--layer-inset)',
    ink: tokenReference('content-0'),
    'ink-muted': tokenReference('content-1'),
    'ink-subtle': tokenReference('content-2'),
    'ink-disabled': tokenReference('content-3'),
    'ink-placeholder': tokenReference('content-4'),
    link: tokenReference('accent'),
    'link-hover': tokenReference('accent'),
    'link-visited': tokenReference('accent'),
    page: tokenReference('surface-0'),
    panel: tokenReference('surface-1'),
    dialog: tokenReference('surface-2'),
    menu: tokenReference('surface-2'),
    tooltip: tokenReference('surface-2'),
    toast: tokenReference('surface-2'),
    input: 'transparent',
    'input-focus': tokenReference('surface-1'),
    message: tokenReference('surface-1'),
    hover: alphaToken('content-0', 0.03),
    active: alphaToken('content-0', 0.06),
    selected: alphaToken('accent', 0.08),
    success: tokenReference('green'),
    warning: tokenReference(mode === 'dark' ? 'amber' : 'yellow'),
    failure: tokenReference('red'),
    chrome: tokenReference('surface-4'),
  };
}

/** Fills optional semantic assignments from the central defaults and drops
 * tokens removed from the V3 registry while preserving extension keys. */
export function normalizeThemeColorTokens(
  tokens: ThemeColorTokens,
  mode: ThemeColorMode
): ThemeColorTokens {
  const next: ThemeColorTokens = {
    ...getDefaultSemanticColorTokens(mode),
    ...tokens,
  };
  delete next['surface-5'];
  delete next['edge-subtle'];
  delete next.lift;
  return next;
}

/**
 * Converts a legacy b/c/a theme into the VNext flat token model. Palette
 * colors preserve a0's lightness and chroma at fixed Tailwind hue angles.
 */
export function legacyThemeToVNextTokens(
  theme: Pick<ThemeV2, 'tokens' | 'overrides'> | { tokens: ThemeV2Tokens },
  mode: ThemeColorMode
): ThemeColorTokens {
  const { tokens } = theme;
  const surfaces = buildSurfaceRamp(tokens, mode);
  const result: ThemeColorTokens = {
    'surface-0': surfaces[0] ?? oklch(tokens.b0),
    'surface-1': surfaces[1] ?? oklch(tokens.b1),
    'surface-2': surfaces[2] ?? oklch(tokens.b2),
    'surface-3': surfaces[3] ?? oklch(tokens.b3),
    'surface-4': surfaces[4] ?? oklch(tokens.b4),
    'content-0': oklch(tokens.c0),
    'content-1': oklch(tokens.c1),
    'content-2': oklch(tokens.c2),
    'content-3': oklch(tokens.c3),
    'content-4': oklch(tokens.c4),
    edge: oklch(tokens.b4),
    'edge-muted': oklch(tokens.b3),
    accent: oklch(tokens.a0),
  };

  for (const [name, hue] of Object.entries(PALETTE_HUES)) {
    result[name] = oklch({ l: tokens.a0.l, c: tokens.a0.c, h: hue });
  }

  const defaults = getDefaultSemanticColorTokens(mode);

  Object.assign(result, defaults);

  // Preserve the old custom semantic overrides during conversion.
  const overrides = 'overrides' in theme ? theme.overrides : undefined;
  for (const override of overrides ?? []) {
    if (override.token in defaults)
      result[override.token] = oklch(override.value);
  }

  return result;
}

export function getThemeColorMode(tokens: ThemeV2Tokens): ThemeColorMode {
  return tokens.c0.l > tokens.b0.l ? 'dark' : 'light';
}

export function getThemeColorTokens(theme: ThemeV2): ThemeColorTokens {
  return {
    ...legacyThemeToVNextTokens(theme, getThemeColorMode(theme.tokens)),
    ...theme.colorTokens,
  };
}

export function isInputColorToken(token: string): token is InputColorToken {
  return (
    token.startsWith('surface-') ||
    token.startsWith('content-') ||
    token === 'edge' ||
    token === 'edge-muted' ||
    token === 'accent' ||
    token in PALETTE_HUES
  );
}
