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

export type ThemeV2 = {
  id: string;
  name: string;
  version: number;
  depth: number;
  tokens: ThemeV2Tokens;
};

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
