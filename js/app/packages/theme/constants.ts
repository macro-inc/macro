import type { ThemeV1 } from './types/themeTypes';

export const DEFAULT_LIGHT_THEME: DefaultTheme = 'Macro Light';
export const DEFAULT_DARK_THEME: DefaultTheme = 'Macro Dark';
export const BEVELED_CORNERS: boolean = true;
export const BLACK_BEZELS: boolean = false;


export const DEFAULT_THEMES = [
  {
    id: 'Macro Dark',
    name: 'Macro Dark',
    version: 1,
    tokens: {
      a0: { l: 0.75, c: 0.20, h:  59 },
      a1: { l: 0.88, c: 0.20, h:  99 },
      a2: { l: 0.88, c: 0.20, h: 139 },
      a3: { l: 0.88, c: 0.20, h: 179 },
      a4: { l: 0.88, c: 0.20, h: 219 },
      b0: { l: 0.14, c: 0.00, h: 158 },
      b1: { l: 0.16, c: 0.00, h:  59 },
      b2: { l: 0.18, c: 0.00, h:  59 },
      b3: { l: 0.20, c: 0.00, h:  59 },
      b4: { l: 0.26, c: 0.00, h:  59 },
      c0: { l: 0.96, c: 0.00, h:  59 },
      c1: { l: 0.93, c: 0.00, h:  59 },
      c2: { l: 0.90, c: 0.00, h:  59 },
      c3: { l: 0.87, c: 0.00, h:  59 },
      c4: { l: 0.85, c: 0.00, h:  59 },
    },
  },
  {
    id: 'Macro Light',
    name: 'Macro Light',
    version: 1,
    tokens: {
      a0: { l: 0.67, c: 0.29, h:  82 },
      a1: { l: 0.70, c: 0.30, h: 185 },
      a2: { l: 0.70, c: 0.30, h: 225 },
      a3: { l: 0.70, c: 0.30, h: 265 },
      a4: { l: 0.70, c: 0.30, h: 305 },
      b0: { l: 0.72, c: 0.00, h: 158 },
      b1: { l: 0.87, c: 0.00, h: 158 },
      b2: { l: 0.88, c: 0.00, h: 158 },
      b3: { l: 0.89, c: 0.00, h: 158 },
      b4: { l: 0.90, c: 0.00, h: 158 },
      c0: { l: 0.14, c: 0.00, h: 153 },
      c1: { l: 0.50, c: 0.00, h: 153 },
      c2: { l: 0.60, c: 0.00, h: 153 },
      c3: { l: 0.70, c: 0.00, h: 153 },
      c4: { l: 0.70, c: 0.00, h: 153 },
    },
  },
  {
    id: 'Bleach',
    name: 'Bleach',
    version: 1,
    tokens: {
      a0: { l: 0.61, c: 0.37, h:  14 },
      a1: { l: 0.61, c: 0.37, h:  54 },
      a2: { l: 0.61, c: 0.37, h:  94 },
      a3: { l: 0.61, c: 0.37, h: 134 },
      a4: { l: 0.61, c: 0.37, h: 174 },
      b0: { l: 0.97, c: 0.00, h:  14 },
      b1: { l: 0.94, c: 0.00, h:  14 },
      b2: { l: 0.90, c: 0.00, h:  14 },
      b3: { l: 0.89, c: 0.00, h:  14 },
      b4: { l: 0.72, c: 0.00, h:  14 },
      c0: { l: 0.34, c: 0.00, h:  14 },
      c1: { l: 0.48, c: 0.00, h:  14 },
      c2: { l: 0.58, c: 0.00, h:  14 },
      c3: { l: 0.62, c: 0.00, h:  14 },
      c4: { l: 0.71, c: 0.00, h:  14 },
    },
  }
] as const satisfies ReadonlyArray<ThemeV1>;

type DefaultTheme = (typeof DEFAULT_THEMES)[number]['id'];
