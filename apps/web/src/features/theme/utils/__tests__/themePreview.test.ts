import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  committedThemeAccent,
  currentThemeId,
  isThemeSaved,
  liveThemeMode,
  themeColorTokens,
} from '../../signals/themeSignals';
import {
  applyTheme,
  clearThemePreview,
  previewTheme,
  scheduleThemePreviewEnd,
  updateLiveThemeColorToken,
} from '../themeUtils';

vi.mock('@core/component/Toast/Toast', () => ({ toast: { alert: vi.fn() } }));

describe('theme preview lifecycle', () => {
  beforeEach(() => applyTheme('Macro Dark'));
  afterEach(() => {
    clearThemePreview();
    vi.restoreAllMocks();
  });

  it('hands off previews without restoring the original palette between rows', async () => {
    previewTheme('Macro Light');
    const write = vi.spyOn(document.documentElement.style, 'setProperty');
    scheduleThemePreviewEnd();
    previewTheme('Void');
    await Promise.resolve();
    const surfaceWrites = write.mock.calls.filter(
      ([name]) => name === '--color-surface-0'
    );
    expect(surfaceWrites).toHaveLength(1);
    expect(currentThemeId()).toBe('Macro Dark');
    expect(liveThemeMode()).toBe('dark');
    scheduleThemePreviewEnd();
    await Promise.resolve();
    expect(themeColorTokens()['surface-0']).toBe('oklch(0.17 0 0deg)');
  });

  it('restores unsaved token edits on dismissal', async () => {
    updateLiveThemeColorToken('accent', 'oklch(0.8 0.1 120)');
    previewTheme('Macro Light');
    scheduleThemePreviewEnd();
    await Promise.resolve();
    expect(themeColorTokens().accent).toBe('oklch(0.8 0.1 120)');
    expect(isThemeSaved()).toBe(false);
  });

  it('keeps committed icons unchanged during preview and retains an explicit commit', async () => {
    const accent = committedThemeAccent();
    previewTheme('Macro Light');
    expect(committedThemeAccent()).toBe(accent);
    scheduleThemePreviewEnd();
    applyTheme('Macro Light');
    await Promise.resolve();
    expect(currentThemeId()).toBe('Macro Light');
    expect(liveThemeMode()).toBe('light');
    expect(committedThemeAccent()).not.toBe(accent);
    expect(document.documentElement.dataset.themeLight).toBe('true');
  });

  it('previews built-in themes without computed-style reads or legacy properties', () => {
    const read = vi.spyOn(window, 'getComputedStyle');
    const write = vi.spyOn(document.documentElement.style, 'setProperty');
    previewTheme('Macro Light');
    clearThemePreview();
    expect(read).not.toHaveBeenCalled();
    expect(
      write.mock.calls.some(([key]) => /^--[abc][0-4][lch]$/.test(key))
    ).toBe(false);
  });

  it('preserves an authored accent contrast and restores the derived default', () => {
    updateLiveThemeColorToken('accent-contrast', 'oklch(0.3 0.1 60)');
    expect(
      document.documentElement.style.getPropertyValue('--color-accent-contrast')
    ).toBe('oklch(0.3 0.1 60)');
    applyTheme('Macro Dark');
    expect(
      document.documentElement.style.getPropertyValue('--color-accent-contrast')
    ).not.toBe('oklch(0.3 0.1 60)');
  });
});
