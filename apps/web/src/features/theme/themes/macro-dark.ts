import type { ThemeV2Tokens } from '../types/themeTypes';
import { defineLegacyDefaultTheme } from './defineLegacyDefaultTheme';

// One ramp for every pointer type: the desktop chrome is a flat, unified
// black layout, so it shares the true-black surface-0 the touch layout
// already used rather than lifting to a lighter graphite.
const tokens: ThemeV2Tokens = {
  a0: { l: 0.75, c: 0.2, h: 59 },
  a1: { l: 0.75, c: 0.2, h: 99 },
  a2: { l: 0.75, c: 0.2, h: 139 },
  a3: { l: 0.75, c: 0.2, h: 179 },
  a4: { l: 0.75, c: 0.2, h: 219 },
  b0: { l: 0, c: 0, h: 21 },
  b1: { l: 0.18, c: 0, h: 21 },
  b2: { l: 0.23, c: 0, h: 21 },
  b3: { l: 0.25, c: 0, h: 21 },
  b4: { l: 0.28, c: 0, h: 21 },
  c0: { l: 1, c: 0, h: 21 },
  c1: { l: 0.83, c: 0, h: 21 },
  c2: { l: 0.75, c: 0, h: 21 },
  c3: { l: 0.63, c: 0, h: 21 },
  c4: { l: 0.55, c: 0, h: 21 },
};

const baseTheme = defineLegacyDefaultTheme({
  id: 'Macro Dark',
  tokens,
});

export const macroDarkTheme: typeof baseTheme = {
  ...baseTheme,
  colorTokens: {
    ...baseTheme.colorTokens,
    edge: '#1c1c1c',
    'edge-muted': '#181818',
  },
};
