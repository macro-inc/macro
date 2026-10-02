import { registerHotkey } from '@core/hotkey/hotkeys';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createListController } from './create-list-controller';
import { useListInteractions } from './use-list-interactions';

vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(() => ({ withGroup: vi.fn() })),
  createHotkeyGroup: () => ({ dispose: vi.fn() }),
}));
vi.mock('@core/hotkey/utils', () => ({
  isScopeInActiveBranch: () => true,
  registerScope: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it('keeps H on entities available for reminders and consumes it on headers', () => {
  createRoot((dispose) => {
    try {
      const [expanded, setExpanded] = createSignal(true);
      const list = createListController({
        items: () => [
          { id: 'header', header: true },
          { id: 'task', header: false },
        ],
        getKey: (item) => item.id,
      });
      useListInteractions({
        controller: list,
        scopeId: 'test',
        scrollHandle: () => undefined,
        disclosure: {
          isHeader: (item) => item.header,
          getKey: () => 'group',
          isExpanded: expanded,
          setExpanded: (_key, value) => setExpanded(value),
          getFocusKey: () => 'header',
        },
      });
      const handler = (key: 'h' | 'arrowleft') => {
        const call = vi
          .mocked(registerHotkey)
          .mock.calls.find(
            ([options]) =>
              Array.isArray(options.hotkey) && options.hotkey.includes(key)
          );
        expect(call).toBeDefined();
        return call![0].keyDownHandler!();
      };
      const collapseCommands = vi
        .mocked(registerHotkey)
        .mock.calls.map(([options]) => options)
        .filter(
          (options) =>
            typeof options.description === 'string' &&
            options.description.startsWith('Collapse')
        );
      expect(
        new Set(collapseCommands.map((command) => command.hotkeyToken)).size
      ).toBe(2);
      list.focus.set('task');
      expect(handler('h')).toBe(false);
      expect(expanded()).toBe(true);
      expect(list.focus.key()).toBe('task');
      expect(handler('arrowleft')).toBe(true);
      expect(expanded()).toBe(false);
      expect(list.focus.key()).toBe('header');
      expect(handler('h')).toBe(true);
      expect(expanded()).toBe(false);
      setExpanded(true);
      expect(handler('h')).toBe(true);
      expect(expanded()).toBe(false);
    } finally {
      dispose();
    }
  });
});

it('lets focused native actions own Enter while preserving ordinary and programmatic list activation', () => {
  createRoot((dispose) => {
    try {
      const activate = vi.fn();
      const list = createListController({
        items: () => [{ id: 'email' }],
        getKey: (row) => row.id,
        onActivate: activate,
      });
      useListInteractions({
        controller: list,
        scopeId: 'email',
        scrollHandle: () => undefined,
        activation: {
          shouldHandleKeyEvent: (event) =>
            !(
              event?.target instanceof Element &&
              event.target.closest('button[data-reminder-action]')
            ),
        },
      });
      list.focus.set('email');
      const button = document.createElement('button');
      button.setAttribute('data-reminder-action', '');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'target', { value: button });
      for (const key of ['enter', 'shift+enter']) {
        const hotkey = vi
          .mocked(registerHotkey)
          .mock.calls.find(([options]) => options.hotkey === key)![0];
        expect(hotkey.keyDownHandler(event)).toBe(false);
        expect(activate).not.toHaveBeenCalled();
      }
      const primary = vi
        .mocked(registerHotkey)
        .mock.calls.find(([options]) => options.hotkey === 'enter')![0];
      expect(
        primary.keyDownHandler(new KeyboardEvent('keydown', { key: 'Enter' }))
      ).toBe(true);
      expect(primary.keyDownHandler()).toBe(true);
      expect(activate).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }
  });
});
