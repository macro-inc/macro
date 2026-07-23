import { registerHotkey } from '@core/hotkey/hotkeys';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSplitHotkeys } from '../registerSplitHotkeys';

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
}));

vi.mock('@core/hotkey/tokens', () => ({
  TOKENS: {
    split: {
      close: 'split.close',
      go: { back: 'split.go.back', forward: 'split.go.forward' },
    },
    window: {
      spotlight: { toggle: 'window.spotlight.toggle' },
      focusSplitRight: 'window.focusSplitRight',
      focusSplitLeft: 'window.focusSplitLeft',
    },
  },
}));

vi.mock('../layoutUtils', () => ({
  focusAdjacentSplit: vi.fn(),
}));

vi.mock('../utils/canSpotlight', () => ({
  canSpotlight: () => false,
}));

describe('registerSplitHotkeys', () => {
  beforeEach(() => {
    vi.mocked(registerHotkey).mockClear();
  });

  it('disables cmd+escape and opt+escape inside a Preview Pair Viewer', () => {
    let isPreviewSplit = true;
    registerSplitHotkeys({
      splitHotkeyScope: 'split=test',
      insertSplit: vi.fn(),
      closeSplit: vi.fn(),
      toggleSpotlight: vi.fn(),
      canGoBack: () => false,
      goBack: vi.fn(),
      canGoForward: () => false,
      goForward: vi.fn(),
      goHome: vi.fn(),
      splitName: () => 'Test',
      getSplitCount: () => 2,
      isNotUnifiedList: () => true,
      isViewerSplit: () => isPreviewSplit,
    });

    const closeRegistration = vi.mocked(registerHotkey).mock.calls[0]?.[0];
    expect(closeRegistration?.hotkey).toEqual(['cmd+escape', 'opt+escape']);
    expect(closeRegistration?.condition?.()).toBe(false);

    isPreviewSplit = false;
    expect(closeRegistration?.condition?.()).toBe(true);
  });
});
