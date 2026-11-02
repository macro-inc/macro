import { registerHotkey } from '@core/hotkey/hotkeys';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useViewTabHotkeys } from './use-view-tab-hotkeys';

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(() => ({ withGroup: vi.fn() })),
  createHotkeyGroup: () => ({ dispose: vi.fn() }),
}));

const handler = (key: string) =>
  vi
    .mocked(registerHotkey)
    .mock.calls.findLast(([options]) => options.hotkey === key)![0]
    .keyDownHandler!;

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

it('cycles Tab through sequential ids while number keys keep every tab', () => {
  createRoot((dispose) => {
    const move = vi.fn();
    const [active, setActive] = createSignal('sent');
    useViewTabHotkeys({
      scopeId: 'email',
      ids: () => ['important', 'favorites', 'sent'],
      sequentialIds: () => ['important', 'noise'],
      activeId: active,
      setActiveId: move,
    });
    expect(handler('tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('important');
    setActive('important');
    expect(handler('tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('noise');
    setActive('noise');
    expect(handler('tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('important');
    expect(handler('shift+tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('important');
    setActive('sent');
    expect(handler('shift+tab')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('noise');
    expect(handler('3')()).toBe(true);
    expect(move).toHaveBeenLastCalledWith('sent');
    dispose();
  });
});
