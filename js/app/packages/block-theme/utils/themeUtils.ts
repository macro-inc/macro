import { toast } from '@core/component/Toast/Toast';
import { batch, createEffect, on } from 'solid-js';
import { DEFAULT_DARK_THEME } from '../constants';
import { themeReactive } from '../signals/themeReactive';
import {
  currentThemeId,
  darkModeTheme,
  lightModeTheme,
  setCurrentThemeId,
  setHtmlColor,
  setIsThemeSaved,
  setUserThemes,
  systemMode,
  themeShouldMatchSystem,
  themes,
  userThemes,
} from '../signals/themeSignals';
import type { ThemeV1, ThemeV1Tokens } from '../types/themeTypes';

export function exportTheme() {
  let id = currentThemeId();
  let theme = JSON.stringify(themes().find((t) => t.id === id));
  navigator.clipboard.writeText(theme);
}

export function systemThemeEffect() {
  createEffect(
    on(
      [themeShouldMatchSystem, systemMode, darkModeTheme, lightModeTheme],
      () => {
        if (themeShouldMatchSystem()) {
          applyTheme(
            systemMode() === 'dark' ? darkModeTheme() : lightModeTheme()
          );
        }
      },
      { defer: true }
    )
  );
}

export function applyTheme(id: string): void {
  let theme = themes().find((t) => t.id === id);
  if (!theme) {
    console.error(`theme not found: ${id}`);
    theme = themes().find((t) => t.id === DEFAULT_DARK_THEME)!;
  }
  setCurrentThemeId(theme.id);

  batch(() => {
    (Object.keys(theme!.tokens) as Array<keyof ThemeV1Tokens>).forEach(
      (tokenKey) => {
        (
          Object.keys(theme!.tokens[tokenKey]) as Array<'l' | 'c' | 'h'>
        ).forEach((prop) => {
          themeReactive[tokenKey][prop][1](theme!.tokens[tokenKey][prop]);
        });
      }
    );
    queueMicrotask(() => {
      /* scuffed af */
      setIsThemeSaved(true);
      setHtmlColor({
        color: `oklch(${themeReactive.b0.l[0]()} ${themeReactive.b0.c[0]()} ${themeReactive.b0.h[0]()}deg)`,
      });
    });
  });
}

export function invertTheme(): void {
  batch(() => {
    themeReactive.b0.l[1](1 - themeReactive.b0.l[0]());
    themeReactive.b2.l[1](1 - themeReactive.b2.l[0]());
    themeReactive.b1.l[1](1 - themeReactive.b1.l[0]());
    themeReactive.b3.l[1](1 - themeReactive.b3.l[0]());
    themeReactive.b4.l[1](1 - themeReactive.b4.l[0]());
    themeReactive.c0.l[1](1 - themeReactive.c0.l[0]());
    themeReactive.c1.l[1](1 - themeReactive.c1.l[0]());
    themeReactive.c2.l[1](1 - themeReactive.c2.l[0]());
    themeReactive.c3.l[1](1 - themeReactive.c3.l[0]());
    themeReactive.c4.l[1](1 - themeReactive.c4.l[0]());
  });
}

function getCurrentTokens(): ThemeV1Tokens {
  const themeTokens: ThemeV1Tokens = {
    a0: {
      l: themeReactive.a0.l[0](),
      c: themeReactive.a0.c[0](),
      h: themeReactive.a0.h[0](),
    },
    a1: {
      l: themeReactive.a1.l[0](),
      c: themeReactive.a1.c[0](),
      h: themeReactive.a1.h[0](),
    },
    a2: {
      l: themeReactive.a2.l[0](),
      c: themeReactive.a2.c[0](),
      h: themeReactive.a2.h[0](),
    },
    a3: {
      l: themeReactive.a3.l[0](),
      c: themeReactive.a3.c[0](),
      h: themeReactive.a3.h[0](),
    },
    a4: {
      l: themeReactive.a4.l[0](),
      c: themeReactive.a4.c[0](),
      h: themeReactive.a4.h[0](),
    },
    b0: {
      l: themeReactive.b0.l[0](),
      c: themeReactive.b0.c[0](),
      h: themeReactive.b0.h[0](),
    },
    b1: {
      l: themeReactive.b1.l[0](),
      c: themeReactive.b1.c[0](),
      h: themeReactive.b1.h[0](),
    },
    b2: {
      l: themeReactive.b2.l[0](),
      c: themeReactive.b2.c[0](),
      h: themeReactive.b2.h[0](),
    },
    b3: {
      l: themeReactive.b3.l[0](),
      c: themeReactive.b3.c[0](),
      h: themeReactive.b3.h[0](),
    },
    b4: {
      l: themeReactive.b4.l[0](),
      c: themeReactive.b4.c[0](),
      h: themeReactive.b4.h[0](),
    },
    c0: {
      l: themeReactive.c0.l[0](),
      c: themeReactive.c0.c[0](),
      h: themeReactive.c0.h[0](),
    },
    c1: {
      l: themeReactive.c1.l[0](),
      c: themeReactive.c1.c[0](),
      h: themeReactive.c1.h[0](),
    },
    c2: {
      l: themeReactive.c2.l[0](),
      c: themeReactive.c2.c[0](),
      h: themeReactive.c2.h[0](),
    },
    c3: {
      l: themeReactive.c3.l[0](),
      c: themeReactive.c3.c[0](),
      h: themeReactive.c3.h[0](),
    },
    c4: {
      l: themeReactive.c4.l[0](),
      c: themeReactive.c4.c[0](),
      h: themeReactive.c4.h[0](),
    },
  };
  return themeTokens;
}

export function saveTheme(name: string): void {
  const id = crypto.randomUUID();
  const tokens = getCurrentTokens();
  const newTheme: ThemeV1 = {
    id: id,
    name: name,
    version: 1,
    tokens: tokens,
  };
  setUserThemes([...userThemes(), newTheme]);
  setCurrentThemeId(id);
  setIsThemeSaved(true);
}

export function deleteTheme(id: string): void {
  setUserThemes(userThemes().filter((theme) => theme.id !== id));
  setIsThemeSaved(false);
  setCurrentThemeId('');
}

/** Checks if the theme contrast is too low, and if so, applies a readable theme. This is to prevent malicious actors sending "Theme Viruses" which make a user's theme unusable. */
export function ensureMinimalThemeContrast() {
  const spec = themes().find((t) => t.id === currentThemeId())?.tokens;
  if (!spec) return;
  // Check if the contrast is too low, so that users can't get stuck with an unreadable theme
  const lowContrastTheme = Math.abs(spec.c0.l - spec.b0.l) < 0.2;
  if (lowContrastTheme) {
    applyTheme(DEFAULT_DARK_THEME);
    toast.alert(
      'Tried to load a theme with low contrast, applying a readable theme.'
    );
  }
}
