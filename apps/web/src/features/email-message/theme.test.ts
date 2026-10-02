import { createComputed, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  setThemeColorTokens,
  themeColorTokens,
} from '../theme/signals/themeSignals';
import { createEmailTheme } from './theme';

describe('email theme colors', () => {
  it('only invalidates HTML when the contrast algorithm inputs change', () => {
    createRoot((dispose) => {
      const original = themeColorTokens();
      try {
        const theme = createEmailTheme();
        let updates = 0;
        createComputed(() => {
          theme();
          updates++;
        });
        const first = theme();
        setThemeColorTokens({ ...original, edge: 'oklch(0.55 0.1 25)' });
        expect(theme()).toBe(first);
        expect(updates).toBe(1);
        setThemeColorTokens({ ...original, accent: 'oklch(0.88 0.1 25)' });
        expect(theme().accentL).toBeCloseTo(0.88);
        expect(updates).toBe(2);
      } finally {
        dispose();
        setThemeColorTokens(original);
      }
    });
  });
});
