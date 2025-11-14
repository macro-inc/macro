import { createEffect, createSignal, on } from 'solid-js';
import type { ThemePrevious, ThemeReactive } from '../types/themeTypes';
import { setIsThemeSaved, setThemeUpdate, themeUpdate } from './themeSignals';

export const themeReactive: ThemeReactive = {
  a0: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  a1: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  a2: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  a3: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  a4: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  b0: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  b1: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  b2: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  b3: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  b4: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  c0: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  c1: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  c2: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  c3: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
  c4: { l: createSignal(0), c: createSignal(0), h: createSignal(0) },
};

const previousTheme: ThemePrevious = {
  a0: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  a1: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  a2: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  a3: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  a4: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  b0: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  b1: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  b2: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  b3: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  b4: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  c0: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  c1: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  c2: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  c3: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
  c4: { l: Number.NaN, c: Number.NaN, h: Number.NaN },
};

let transitionState = false;
function jamTransition(): void {
  if (!transitionState) {
    transitionState = true;
    document.documentElement.style.setProperty('--transition', '0s');

    setTimeout(() => {
      document.documentElement.style.setProperty('--transition', '0.5s');
      transitionState = false;
    }, 100);
  }
}
const ALL_THEME_SIGNALS = [
  themeReactive.a0.l[0],
  themeReactive.a0.c[0],
  themeReactive.a0.h[0],
  themeReactive.a1.l[0],
  themeReactive.a1.c[0],
  themeReactive.a1.h[0],
  themeReactive.a2.l[0],
  themeReactive.a2.c[0],
  themeReactive.a2.h[0],
  themeReactive.a3.l[0],
  themeReactive.a3.c[0],
  themeReactive.a3.h[0],
  themeReactive.a4.l[0],
  themeReactive.a4.c[0],
  themeReactive.a4.h[0],
  themeReactive.b0.l[0],
  themeReactive.b0.c[0],
  themeReactive.b0.h[0],
  themeReactive.b1.l[0],
  themeReactive.b1.c[0],
  themeReactive.b1.h[0],
  themeReactive.b2.l[0],
  themeReactive.b2.c[0],
  themeReactive.b2.h[0],
  themeReactive.b3.l[0],
  themeReactive.b3.c[0],
  themeReactive.b3.h[0],
  themeReactive.b4.l[0],
  themeReactive.b4.c[0],
  themeReactive.b4.h[0],
  themeReactive.c0.l[0],
  themeReactive.c0.h[0],
  themeReactive.c0.c[0],
  themeReactive.c1.l[0],
  themeReactive.c1.c[0],
  themeReactive.c1.h[0],
  themeReactive.c2.l[0],
  themeReactive.c2.c[0],
  themeReactive.c2.h[0],
  themeReactive.c3.l[0],
  themeReactive.c3.c[0],
  themeReactive.c3.h[0],
  themeReactive.c4.l[0],
  themeReactive.c4.c[0],
  themeReactive.c4.h[0],
];

createEffect(
  on(
    ALL_THEME_SIGNALS,
    () => {
      jamTransition();

      if (themeReactive.a0.l[0]() !== previousTheme.a0.l) {
        document.documentElement.style.setProperty(
          '--a0l',
          `${themeReactive.a0.l[0]()}`
        );
        previousTheme.a0.l = themeReactive.a0.l[0]();
      }
      if (themeReactive.a0.c[0]() !== previousTheme.a0.c) {
        document.documentElement.style.setProperty(
          '--a0c',
          `${themeReactive.a0.c[0]()}`
        );
        previousTheme.a0.c = themeReactive.a0.c[0]();
      }
      if (themeReactive.a0.h[0]() !== previousTheme.a0.h) {
        document.documentElement.style.setProperty(
          '--a0h',
          `${themeReactive.a0.h[0]()}deg`
        );
        previousTheme.a0.h = themeReactive.a0.h[0]();
      }
      if (themeReactive.a1.l[0]() !== previousTheme.a1.l) {
        document.documentElement.style.setProperty(
          '--a1l',
          `${themeReactive.a1.l[0]()}`
        );
        previousTheme.a1.l = themeReactive.a1.l[0]();
      }
      if (themeReactive.a1.c[0]() !== previousTheme.a1.c) {
        document.documentElement.style.setProperty(
          '--a1c',
          `${themeReactive.a1.c[0]()}`
        );
        previousTheme.a1.c = themeReactive.a1.c[0]();
      }
      if (themeReactive.a1.h[0]() !== previousTheme.a1.h) {
        document.documentElement.style.setProperty(
          '--a1h',
          `${themeReactive.a1.h[0]()}deg`
        );
        previousTheme.a1.h = themeReactive.a1.h[0]();
      }
      if (themeReactive.a2.l[0]() !== previousTheme.a2.l) {
        document.documentElement.style.setProperty(
          '--a2l',
          `${themeReactive.a2.l[0]()}`
        );
        previousTheme.a2.l = themeReactive.a2.l[0]();
      }
      if (themeReactive.a2.c[0]() !== previousTheme.a2.c) {
        document.documentElement.style.setProperty(
          '--a2c',
          `${themeReactive.a2.c[0]()}`
        );
        previousTheme.a2.c = themeReactive.a2.c[0]();
      }
      if (themeReactive.a2.h[0]() !== previousTheme.a2.h) {
        document.documentElement.style.setProperty(
          '--a2h',
          `${themeReactive.a2.h[0]()}deg`
        );
        previousTheme.a2.h = themeReactive.a2.h[0]();
      }
      if (themeReactive.a3.l[0]() !== previousTheme.a3.l) {
        document.documentElement.style.setProperty(
          '--a3l',
          `${themeReactive.a3.l[0]()}`
        );
        previousTheme.a3.l = themeReactive.a3.l[0]();
      }
      if (themeReactive.a3.c[0]() !== previousTheme.a3.c) {
        document.documentElement.style.setProperty(
          '--a3c',
          `${themeReactive.a3.c[0]()}`
        );
        previousTheme.a3.c = themeReactive.a3.c[0]();
      }
      if (themeReactive.a3.h[0]() !== previousTheme.a3.h) {
        document.documentElement.style.setProperty(
          '--a3h',
          `${themeReactive.a3.h[0]()}deg`
        );
        previousTheme.a3.h = themeReactive.a3.h[0]();
      }
      if (themeReactive.a4.l[0]() !== previousTheme.a4.l) {
        document.documentElement.style.setProperty(
          '--a4l',
          `${themeReactive.a4.l[0]()}`
        );
        previousTheme.a4.l = themeReactive.a4.l[0]();
      }
      if (themeReactive.a4.c[0]() !== previousTheme.a4.c) {
        document.documentElement.style.setProperty(
          '--a4c',
          `${themeReactive.a4.c[0]()}`
        );
        previousTheme.a4.c = themeReactive.a4.c[0]();
      }
      if (themeReactive.a4.h[0]() !== previousTheme.a4.h) {
        document.documentElement.style.setProperty(
          '--a4h',
          `${themeReactive.a4.h[0]()}deg`
        );
        previousTheme.a4.h = themeReactive.a4.h[0]();
      }
      if (themeReactive.b0.l[0]() !== previousTheme.b0.l) {
        document.documentElement.style.setProperty(
          '--b0l',
          `${themeReactive.b0.l[0]()}`
        );
        previousTheme.b0.l = themeReactive.b0.l[0]();
      }
      if (themeReactive.b0.c[0]() !== previousTheme.b0.c) {
        document.documentElement.style.setProperty(
          '--b0c',
          `${themeReactive.b0.c[0]()}`
        );
        previousTheme.b0.c = themeReactive.b0.c[0]();
      }
      if (themeReactive.b0.h[0]() !== previousTheme.b0.h) {
        document.documentElement.style.setProperty(
          '--b0h',
          `${themeReactive.b0.h[0]()}deg`
        );
        previousTheme.b0.h = themeReactive.b0.h[0]();
      }
      if (themeReactive.b1.l[0]() !== previousTheme.b1.l) {
        document.documentElement.style.setProperty(
          '--b1l',
          `${themeReactive.b1.l[0]()}`
        );
        previousTheme.b1.l = themeReactive.b1.l[0]();
      }
      if (themeReactive.b1.c[0]() !== previousTheme.b1.c) {
        document.documentElement.style.setProperty(
          '--b1c',
          `${themeReactive.b1.c[0]()}`
        );
        previousTheme.b1.c = themeReactive.b1.c[0]();
      }
      if (themeReactive.b1.h[0]() !== previousTheme.b1.h) {
        document.documentElement.style.setProperty(
          '--b1h',
          `${themeReactive.b1.h[0]()}deg`
        );
        previousTheme.b1.h = themeReactive.b1.h[0]();
      }
      if (themeReactive.b2.l[0]() !== previousTheme.b2.l) {
        document.documentElement.style.setProperty(
          '--b2l',
          `${themeReactive.b2.l[0]()}`
        );
        previousTheme.b2.l = themeReactive.b2.l[0]();
      }
      if (themeReactive.b2.c[0]() !== previousTheme.b2.c) {
        document.documentElement.style.setProperty(
          '--b2c',
          `${themeReactive.b2.c[0]()}`
        );
        previousTheme.b2.c = themeReactive.b2.c[0]();
      }
      if (themeReactive.b2.h[0]() !== previousTheme.b2.h) {
        document.documentElement.style.setProperty(
          '--b2h',
          `${themeReactive.b2.h[0]()}deg`
        );
        previousTheme.b2.h = themeReactive.b2.h[0]();
      }
      if (themeReactive.b3.l[0]() !== previousTheme.b3.l) {
        document.documentElement.style.setProperty(
          '--b3l',
          `${themeReactive.b3.l[0]()}`
        );
        previousTheme.b3.l = themeReactive.b3.l[0]();
      }
      if (themeReactive.b3.c[0]() !== previousTheme.b3.c) {
        document.documentElement.style.setProperty(
          '--b3c',
          `${themeReactive.b3.c[0]()}`
        );
        previousTheme.b3.c = themeReactive.b3.c[0]();
      }
      if (themeReactive.b3.h[0]() !== previousTheme.b3.h) {
        document.documentElement.style.setProperty(
          '--b3h',
          `${themeReactive.b3.h[0]()}deg`
        );
        previousTheme.b3.h = themeReactive.b3.h[0]();
      }
      if (themeReactive.b4.l[0]() !== previousTheme.b4.l) {
        document.documentElement.style.setProperty(
          '--b4l',
          `${themeReactive.b4.l[0]()}`
        );
        previousTheme.b4.l = themeReactive.b4.l[0]();
      }
      if (themeReactive.b4.c[0]() !== previousTheme.b4.c) {
        document.documentElement.style.setProperty(
          '--b4c',
          `${themeReactive.b4.c[0]()}`
        );
        previousTheme.b4.c = themeReactive.b4.c[0]();
      }
      if (themeReactive.b4.h[0]() !== previousTheme.b4.h) {
        document.documentElement.style.setProperty(
          '--b4h',
          `${themeReactive.b4.h[0]()}deg`
        );
        previousTheme.b4.h = themeReactive.b4.h[0]();
      }
      if (themeReactive.c0.l[0]() !== previousTheme.c0.l) {
        document.documentElement.style.setProperty(
          '--c0l',
          `${themeReactive.c0.l[0]()}`
        );
        previousTheme.c0.l = themeReactive.c0.l[0]();
      }
      if (themeReactive.c0.c[0]() !== previousTheme.c0.c) {
        document.documentElement.style.setProperty(
          '--c0c',
          `${themeReactive.c0.c[0]()}`
        );
        previousTheme.c0.c = themeReactive.c0.c[0]();
      }
      if (themeReactive.c0.h[0]() !== previousTheme.c0.h) {
        document.documentElement.style.setProperty(
          '--c0h',
          `${themeReactive.c0.h[0]()}deg`
        );
        previousTheme.c0.h = themeReactive.c0.h[0]();
      }
      if (themeReactive.c1.l[0]() !== previousTheme.c1.l) {
        document.documentElement.style.setProperty(
          '--c1l',
          `${themeReactive.c1.l[0]()}`
        );
        previousTheme.c1.l = themeReactive.c1.l[0]();
      }
      if (themeReactive.c1.c[0]() !== previousTheme.c1.c) {
        document.documentElement.style.setProperty(
          '--c1c',
          `${themeReactive.c1.c[0]()}`
        );
        previousTheme.c1.c = themeReactive.c1.c[0]();
      }
      if (themeReactive.c1.h[0]() !== previousTheme.c1.h) {
        document.documentElement.style.setProperty(
          '--c1h',
          `${themeReactive.c1.h[0]()}deg`
        );
        previousTheme.c1.h = themeReactive.c1.h[0]();
      }
      if (themeReactive.c2.l[0]() !== previousTheme.c2.l) {
        document.documentElement.style.setProperty(
          '--c2l',
          `${themeReactive.c2.l[0]()}`
        );
        previousTheme.c2.l = themeReactive.c2.l[0]();
      }
      if (themeReactive.c2.c[0]() !== previousTheme.c2.c) {
        document.documentElement.style.setProperty(
          '--c2c',
          `${themeReactive.c2.c[0]()}`
        );
        previousTheme.c2.c = themeReactive.c2.c[0]();
      }
      if (themeReactive.c2.h[0]() !== previousTheme.c2.h) {
        document.documentElement.style.setProperty(
          '--c2h',
          `${themeReactive.c2.h[0]()}deg`
        );
        previousTheme.c2.h = themeReactive.c2.h[0]();
      }
      if (themeReactive.c3.l[0]() !== previousTheme.c3.l) {
        document.documentElement.style.setProperty(
          '--c3l',
          `${themeReactive.c3.l[0]()}`
        );
        previousTheme.c3.l = themeReactive.c3.l[0]();
      }
      if (themeReactive.c3.c[0]() !== previousTheme.c3.c) {
        document.documentElement.style.setProperty(
          '--c3c',
          `${themeReactive.c3.c[0]()}`
        );
        previousTheme.c3.c = themeReactive.c3.c[0]();
      }
      if (themeReactive.c3.h[0]() !== previousTheme.c3.h) {
        document.documentElement.style.setProperty(
          '--c3h',
          `${themeReactive.c3.h[0]()}deg`
        );
        previousTheme.c3.h = themeReactive.c3.h[0]();
      }
      if (themeReactive.c4.l[0]() !== previousTheme.c4.l) {
        document.documentElement.style.setProperty(
          '--c4l',
          `${themeReactive.c4.l[0]()}`
        );
        previousTheme.c4.l = themeReactive.c4.l[0]();
      }
      if (themeReactive.c4.c[0]() !== previousTheme.c4.c) {
        document.documentElement.style.setProperty(
          '--c4c',
          `${themeReactive.c4.c[0]()}`
        );
        previousTheme.c4.c = themeReactive.c4.c[0]();
      }
      if (themeReactive.c4.h[0]() !== previousTheme.c4.h) {
        document.documentElement.style.setProperty(
          '--c4h',
          `${themeReactive.c4.h[0]()}deg`
        );
        previousTheme.c4.h = themeReactive.c4.h[0]();
      }

      setThemeUpdate(themeUpdate() * -1);
      setIsThemeSaved(false);
    },
    { defer: true }
  )
);

export function createThemeEffect(cb: () => void) {
  return createEffect(on(ALL_THEME_SIGNALS, cb));
}
