import type { Signal } from 'solid-js';

type ThemeReactiveToken = {
  l: Signal<number>;
  c: Signal<number>;
  h: Signal<number>;
  description: string;
};

export type ThemeReactive = {
  a0: ThemeReactiveToken;
  a1: ThemeReactiveToken;
  a2: ThemeReactiveToken;
  a3: ThemeReactiveToken;
  a4: ThemeReactiveToken;
  b0: ThemeReactiveToken;
  b1: ThemeReactiveToken;
  b2: ThemeReactiveToken;
  b3: ThemeReactiveToken;
  b4: ThemeReactiveToken;
  c0: ThemeReactiveToken;
  c1: ThemeReactiveToken;
  c2: ThemeReactiveToken;
  c3: ThemeReactiveToken;
  c4: ThemeReactiveToken;
};

export type ThemeReactiveColor = ThemeReactive[keyof ThemeReactive];

export type ThemePrevious = {
  a0: { l: number; c: number; h: number };
  a1: { l: number; c: number; h: number };
  a2: { l: number; c: number; h: number };
  a3: { l: number; c: number; h: number };
  a4: { l: number; c: number; h: number };
  b0: { l: number; c: number; h: number };
  b1: { l: number; c: number; h: number };
  b2: { l: number; c: number; h: number };
  b3: { l: number; c: number; h: number };
  b4: { l: number; c: number; h: number };
  c0: { l: number; c: number; h: number };
  c1: { l: number; c: number; h: number };
  c2: { l: number; c: number; h: number };
  c3: { l: number; c: number; h: number };
  c4: { l: number; c: number; h: number };
};

export const surfaceTokens = [
  'surface-0',
  'surface-1',
  'surface-2',
  'surface-3',
  'surface-4',
] as const;

export const contentTokens = [
  'content-0',
  'content-1',
  'content-2',
  'content-3',
  'content-4',
] as const;

export const edgeTokens = ['edge', 'edge-muted'] as const;

export const paletteTokens = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'violet',
  'purple',
  'pink',
] as const;

export const inputColorTokens = [
  ...surfaceTokens,
  ...contentTokens,
  ...edgeTokens,
  'accent',
  ...paletteTokens,
] as const;

export type InputColorToken = (typeof inputColorTokens)[number];

export const semanticTokens = [
  'surface',
  'inset',
  'ink',
  'ink-muted',
  'ink-subtle',
  'ink-disabled',
  'ink-placeholder',
  'link',
  'link-hover',
  'link-visited',
  'page',
  'panel',
  'dialog',
  'menu',
  'tooltip',
  'toast',
  'input',
  'input-focus',
  'message',
  'hover',
  'active',
  'selected',
  'success',
  'warning',
  'failure',
  'chrome',
] as const;
export type SemanticToken = (typeof semanticTokens)[number];

/** Flat, serializable source of truth for authored VNext theme colors. */
export type ThemeColorTokens = Record<string, string>;

export type ThemeColorMode = 'light' | 'dark';

type TokenColor = {
  token: SemanticToken;
  value: { l: number; c: number; h: number };
};

export type ThemeV2 = {
  id: string;
  name: string;
  version: 2;
  depth: number;
  tokens: ThemeV2Tokens;
  overrides?: TokenColor[];
  /** VNext input and semantic colors. Legacy themes omit this field. */
  colorTokens?: ThemeColorTokens;
};

/** Token-only theme format. Legacy ramps and depth are generated compatibility
 * state and are deliberately not persisted. */
export type ThemeV3 = {
  id: string;
  name: string;
  version: 3;
  mode: ThemeColorMode;
  colorTokens: ThemeColorTokens;
};

/** The normalized theme shape used by the application at runtime. */
export type Theme = ThemeV3;

export type ThemeV2Tokens = {
  a0: { l: number; c: number; h: number };
  a1: { l: number; c: number; h: number };
  a2: { l: number; c: number; h: number };
  a3: { l: number; c: number; h: number };
  a4: { l: number; c: number; h: number };
  b0: { l: number; c: number; h: number };
  b1: { l: number; c: number; h: number };
  b2: { l: number; c: number; h: number };
  b3: { l: number; c: number; h: number };
  b4: { l: number; c: number; h: number };
  c0: { l: number; c: number; h: number };
  c1: { l: number; c: number; h: number };
  c2: { l: number; c: number; h: number };
  c3: { l: number; c: number; h: number };
  c4: { l: number; c: number; h: number };
};

export type ThemeV1 = {
  id: string;
  name: string;
  version: number;
  tokens: ThemeV1Tokens;
};

export type ThemeV1Tokens = {
  a0: { l: number; c: number; h: number };
  a1: { l: number; c: number; h: number };
  a2: { l: number; c: number; h: number };
  a3: { l: number; c: number; h: number };
  a4: { l: number; c: number; h: number };
  b0: { l: number; c: number; h: number };
  b1: { l: number; c: number; h: number };
  b2: { l: number; c: number; h: number };
  b3: { l: number; c: number; h: number };
  b4: { l: number; c: number; h: number };
  c0: { l: number; c: number; h: number };
  c1: { l: number; c: number; h: number };
  c2: { l: number; c: number; h: number };
  c3: { l: number; c: number; h: number };
  c4: { l: number; c: number; h: number };
};

export type ThemeV0 = {
  id: string;
  name: string;
  specification: {
    '--accent-l': number;
    '--accent-c': number;
    '--accent-h': number;
    '--contrast-l': number;
    '--contrast-l-1': number;
    '--contrast-l-2': number;
    '--contrast-l-3': number;
    '--contrast-l-4': number;
    '--contrast-c': number;
    '--contrast-h': number;
    '--surface-l': number;
    '--surface-l-1': number;
    '--surface-l-2': number;
    '--surface-l-3': number;
    '--surface-l-4': number;
    '--surface-c': number;
    '--surface-h': number;
  };
};
