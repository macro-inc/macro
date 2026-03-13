import { describe, expect, test, vi, beforeEach } from 'vitest';
import { registerSidebarHotkeys } from './sidebar';
import { registerHotkey } from '@core/hotkey/hotkeys';

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
}));

describe('registerSidebarHotkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('registers sidebar toggle hotkey to run with focused input', () => {
    registerSidebarHotkeys({
      isSlim: () => false,
      onOpenChange: vi.fn(),
      openWithSplit: vi.fn(),
    });

    expect(registerHotkey).toHaveBeenCalledWith(
      expect.objectContaining({
        hotkey: 'cmd+.',
        runWithInputFocused: true,
      })
    );
  });

  test('sidebar toggle handler uses current slim state', () => {
    const onOpenChange = vi.fn();
    let slim = true;

    registerSidebarHotkeys({
      isSlim: () => slim,
      onOpenChange,
      openWithSplit: vi.fn(),
    });

    const toggleRegistration = vi
      .mocked(registerHotkey)
      .mock.calls.map(([args]) => args)
      .find((args) => args.hotkey === 'cmd+.');

    expect(toggleRegistration).toBeDefined();

    toggleRegistration?.keyDownHandler();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    slim = false;
    toggleRegistration?.keyDownHandler();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
