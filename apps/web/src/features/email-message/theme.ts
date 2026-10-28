import type { ThemeColorParams } from '@macro-inc/email-renderer/browser';
import { resolvedThemeColors } from '@theme/signals/themeSignals';
import { createMemo } from 'solid-js';

/** Only recolor email HTML when a color used by its contrast algorithm changes. */
export function createEmailTheme() {
  return createMemo<ThemeColorParams, undefined>(
    () => {
      const colors = resolvedThemeColors();
      const ink = colors['content-0'];
      const accent = colors.accent;
      return {
        inkL: ink.l,
        inkC: ink.c,
        inkH: ink.h,
        panelL: colors['surface-1'].l,
        accentL: accent.l,
        accentC: accent.c,
        accentH: accent.h,
      };
    },
    undefined,
    {
      equals: (a, b) =>
        a.inkL === b.inkL &&
        a.inkC === b.inkC &&
        a.inkH === b.inkH &&
        a.panelL === b.panelL &&
        a.accentL === b.accentL &&
        a.accentC === b.accentC &&
        a.accentH === b.accentH,
    }
  );
}
