import { ENABLE_CALLKIT } from '@core/constant/featureFlags';
import { isPlatform, isTauri } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';
import { themeReactive } from '@theme/signals/themeReactive';
import Color from 'colorjs.io';
import { type Accessor, createMemo } from 'solid-js';

export type RgbaColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

export type CallKitDrawerTheme = {
  drawerBackground: RgbaColor;
  text: RgbaColor;
  messageBackground: RgbaColor;
  overlayBackground: RgbaColor;
  edgeMuted: RgbaColor;
  edge: RgbaColor;
  inkMuted: RgbaColor;
  failure: RgbaColor;
  failureInk: RgbaColor;
  success: RgbaColor;
};

export function createCallKitDrawerTheme(): Accessor<CallKitDrawerTheme> {
  return createMemo(currentCallKitTheme, undefined, {
    equals: (a, b) => callKitDrawerThemeKey(a) === callKitDrawerThemeKey(b),
  });
}

export async function setNativeCallKitDrawerTheme(
  theme: CallKitDrawerTheme
): Promise<void> {
  if (!ENABLE_CALLKIT || !isTauri() || !isPlatform('ios')) return;
  await invoke('plugin:call-kit|set_call_drawer_theme', {
    drawerBackground: theme.drawerBackground,
    text: theme.text,
    messageBackground: theme.messageBackground,
    overlayBackground: theme.overlayBackground,
    edgeMuted: theme.edgeMuted,
    edge: theme.edge,
    inkMuted: theme.inkMuted,
    failure: theme.failure,
    failureInk: theme.failureInk,
    success: theme.success,
  }).catch((err) =>
    console.error('[callkit] failed to set native drawer theme', err)
  );
}

function currentCallKitTheme(): CallKitDrawerTheme {
  const b0 = currentThemeToken('b0');
  const c0 = currentThemeToken('c0');
  const b1 = currentThemeToken('b1');
  const b2 = currentThemeToken('b2');
  const b3 = currentThemeToken('b3');
  const b4 = currentThemeToken('b4');
  const c1 = currentThemeToken('c1');
  const message = {
    l: (b1.l + b2.l) / 2,
    c: (b1.c + b2.c) / 2,
    h: (b1.h + b2.h) / 2,
  };
  const failure = { l: 0.637, c: 0.237, h: 25.331 };
  const success = { l: 0.696, c: 0.17, h: 162.48 };

  return {
    drawerBackground: oklchToRgba(b0, { red: 0, green: 0, blue: 0, alpha: 1 }),
    text: oklchToRgba(c0, { red: 1, green: 1, blue: 1, alpha: 1 }),
    messageBackground: oklchToRgba(message, {
      red: 0.08,
      green: 0.08,
      blue: 0.08,
      alpha: 1,
    }),
    overlayBackground: oklchToRgba(
      b1,
      {
        red: 0,
        green: 0,
        blue: 0,
        alpha: 0.46,
      },
      0.8
    ),
    edgeMuted: oklchToRgba(b3, {
      red: 0.18,
      green: 0.18,
      blue: 0.18,
      alpha: 1,
    }),
    edge: oklchToRgba(b4, {
      red: 0.36,
      green: 0.36,
      blue: 0.36,
      alpha: 1,
    }),
    inkMuted: oklchToRgba(c1, {
      red: 0.6,
      green: 0.6,
      blue: 0.6,
      alpha: 1,
    }),
    failure: oklchToRgba(failure, {
      red: 0.95,
      green: 0.1,
      blue: 0.1,
      alpha: 1,
    }),
    failureInk: oklchToRgba(
      { l: c1.l, c: failure.c, h: failure.h },
      {
        red: 1,
        green: 1,
        blue: 1,
        alpha: 1,
      }
    ),
    success: oklchToRgba(success, {
      red: 0.1,
      green: 0.7,
      blue: 0.4,
      alpha: 1,
    }),
  };
}

function currentThemeToken(
  token: 'b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'c0' | 'c1'
) {
  return {
    l: themeReactive[token].l[0](),
    c: themeReactive[token].c[0](),
    h: themeReactive[token].h[0](),
  };
}

function oklchToRgba(
  token: { l: number; c: number; h: number },
  fallback: RgbaColor,
  alpha?: number
): RgbaColor {
  try {
    const srgb = new Color('oklch', [token.l, token.c, token.h]).to('srgb');
    return {
      red: clampColorChannel(srgb.coords[0]),
      green: clampColorChannel(srgb.coords[1]),
      blue: clampColorChannel(srgb.coords[2]),
      alpha: clampColorChannel(alpha ?? srgb.alpha ?? 1),
    };
  } catch (err) {
    console.error('[callkit] failed to resolve theme color', {
      token,
      err,
    });
    return fallback;
  }
}

function callKitDrawerThemeKey(theme: CallKitDrawerTheme): string {
  return [
    colorKeyPart(theme.drawerBackground),
    colorKeyPart(theme.text),
    colorKeyPart(theme.messageBackground),
    colorKeyPart(theme.overlayBackground),
    colorKeyPart(theme.edgeMuted),
    colorKeyPart(theme.edge),
    colorKeyPart(theme.inkMuted),
    colorKeyPart(theme.failure),
    colorKeyPart(theme.failureInk),
    colorKeyPart(theme.success),
  ].join(':');
}

function colorKeyPart(color: RgbaColor): string {
  return [
    color.red.toFixed(4),
    color.green.toFixed(4),
    color.blue.toFixed(4),
    color.alpha.toFixed(4),
  ].join(',');
}

function clampColorChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
