import { registerHotkey } from '@core/hotkey/hotkeys';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useViewTabHotkeys } from './use-view-tab-hotkeys';

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(() => ({ withGroup: vi.fn() })),
  createHotkeyGroup: () => ({ dispose: vi.fn() }),
}));

it('leaves guarded native Tab events alone while retaining programmatic and numbered view navigation', () => {
  createRoot((dispose) => {
    const move = vi.fn();
    const nativeEvent = new KeyboardEvent('keydown', { key: 'Tab' });
    useViewTabHotkeys({
      scopeId: 'email',
      ids: () => ['all', 'reminders'],
      activeId: () => 'all',
      setActiveId: move,
      shouldHandleSequentialKeyEvent: (event) => event !== nativeEvent,
    });
    const handler = (key: string) =>
      vi
        .mocked(registerHotkey)
        .mock.calls.find(([options]) => options.hotkey === key)![0]
        .keyDownHandler!;
    expect(handler('tab')(nativeEvent)).toBe(false);
    expect(handler('shift+tab')(nativeEvent)).toBe(false);
    expect(move).not.toHaveBeenCalled();
    expect(handler('tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('reminders');
    expect(handler('1')(nativeEvent)).toBe(true);
    expect(move).toHaveBeenLastCalledWith('all');
    dispose();
  });
});
