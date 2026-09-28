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

  it('enables close shortcuts for multiple splits but not a sole list', () => {
    let splitCount = 1;
    registerSplitHotkeys({
      splitHotkeyScope: 'split=test',
      insertSplit: vi.fn(),
      closeSplit: vi.fn(),
      toggleSpotlight: vi.fn(),
      canGoBack: () => false,
      goBack: vi.fn(),
      canGoForward: () => false,
      goForward: vi.fn(),
      goToList: vi.fn(),
      splitName: () => 'Test',
      getSplitCount: () => splitCount,
      isNotUnifiedList: () => false,
    });

    const closeRegistration = vi.mocked(registerHotkey).mock.calls[0]?.[0];
    expect(closeRegistration?.hotkey).toEqual(['cmd+escape', 'opt+escape']);
    expect(closeRegistration?.condition?.()).toBe(false);

    splitCount = 2;
    expect(closeRegistration?.condition?.()).toBe(true);
  });
});
