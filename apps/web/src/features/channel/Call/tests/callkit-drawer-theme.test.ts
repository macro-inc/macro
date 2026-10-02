import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { resolveThemeColors } from '../../../theme/utils/resolvedThemeColors';
import { createCallKitDrawerTheme } from '../callkit-drawer-theme';

const { readColors } = vi.hoisted(() => ({ readColors: vi.fn() }));
vi.mock('@theme/signals/themeSignals', () => ({
  resolvedThemeColors: readColors,
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLKIT: false }));
vi.mock('@core/util/platform', () => ({
  isTauri: () => false,
  isPlatform: () => false,
}));

describe('native drawer theme', () => {
  it('defers conversion until a native consumer reads it and reuses equivalent colors', () => {
    createRoot((dispose) => {
      try {
        const [colors, setColors] = createSignal(
          resolveThemeColors({}, 'dark')
        );
        readColors.mockImplementation(colors);
        const theme = createCallKitDrawerTheme();
        expect(readColors).not.toHaveBeenCalled();
        const first = theme();
        expect(theme()).toBe(first);
        setColors(resolveThemeColors({ accent: 'oklch(0.7 0.2 30)' }, 'dark'));
        expect(theme()).toBe(first);
        setColors(
          resolveThemeColors({ 'surface-0': 'oklch(0.9 0 0)' }, 'light')
        );
        expect(theme().drawerBackground.red).toBeGreaterThan(
          first.drawerBackground.red
        );
        for (const color of Object.values(theme())) {
          expect(
            Object.values(color).every(
              (v) => Number.isFinite(v) && v >= 0 && v <= 1
            )
          ).toBe(true);
        }
      } finally {
        dispose();
      }
    });
  });
});
