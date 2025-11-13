import type { Signal } from 'solid-js';

export type ThemeReactive = {
  a0: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  a1: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  a2: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  a3: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  a4: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  b0: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  b1: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  b2: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  b3: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  b4: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  c0: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  c1: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  c2: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  c3: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
  c4: { l: Signal<number>; c: Signal<number>; h: Signal<number> };
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

export type ThemeV1 = {
  id: string;
  name: string;
  version: number;
  tokens: ThemeV1Tokens;
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
