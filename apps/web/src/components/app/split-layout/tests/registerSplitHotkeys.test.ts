import { registerHotkey } from '@core/hotkey/hotkeys';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusAdjacentSplit } from '../layoutUtils';
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
      focusSplitDown: 'window.focusSplitDown',
      focusSplitUp: 'window.focusSplitUp',
    },
  },
}));

vi.mock('../layoutUtils', () => ({
  focusAdjacentSplit: vi.fn(),
}));

vi.mock('../utils/canSpotlight', () => ({
  canSpotlight: () => false,
}));

const register = () =>
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
    getSplitCount: () => 2,
    isNotUnifiedList: () => false,
  });

const focusDown = () =>
  vi
    .mocked(registerHotkey)
    .mock.calls.find(
      ([options]) => options.hotkeyToken === 'window.focusSplitDown'
    )?.[0].keyDownHandler;

describe('registerSplitHotkeys', () => {
  beforeEach(() => {
    vi.mocked(registerHotkey).mockClear();
    vi.mocked(focusAdjacentSplit).mockClear();
    document.body.innerHTML = '';
  });

  it('leaves Shift+Arrow to a focused control that owns arrow keys', () => {
    register();
    document.body.innerHTML =
      '<div data-owns-arrow-keys><button id="cell"></button></div>';
    document.getElementById('cell')!.focus();

    const shiftDown = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      shiftKey: true,
    });
    expect(focusDown()?.(shiftDown)).toBe(false);
    expect(focusAdjacentSplit).not.toHaveBeenCalled();

    const shiftJ = new KeyboardEvent('keydown', { key: 'J', shiftKey: true });
    expect(focusDown()?.(shiftJ)).toBe(true);
    expect(focusAdjacentSplit).toHaveBeenCalledWith('down');
  });

  it('moves split focus with Shift+Arrow elsewhere', () => {
    register();
    document.body.innerHTML = '<button id="row"></button>';
    document.getElementById('row')!.focus();

    const shiftDown = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      shiftKey: true,
    });
    expect(focusDown()?.(shiftDown)).toBe(true);
    expect(focusAdjacentSplit).toHaveBeenCalledWith('down');
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
