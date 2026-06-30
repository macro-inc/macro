import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { onCleanup } from 'solid-js';

type UseInboxListHotkeysOptions = {
  scopeId: string;
  moveUp: () => void;
  moveDown: () => void;
  selectCurrent: () => void;
  activateCurrent: () => void;
  focusFirst: () => void;
  focusLast: () => void;
};

export function useInboxListHotkeys(options: UseInboxListHotkeysOptions) {
  const group = createHotkeyGroup();

  registerHotkey({
    hotkey: ['j', 'arrowdown'],
    scopeId: options.scopeId,
    description: 'Down',
    keyDownHandler: () => {
      options.moveDown();
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['k', 'arrowup'],
    scopeId: options.scopeId,
    description: 'Up',
    keyDownHandler: () => {
      options.moveUp();
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['space'],
    scopeId: options.scopeId,
    description: 'Preview',
    keyDownHandler: () => {
      options.selectCurrent();
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['enter'],
    scopeId: options.scopeId,
    description: 'Open',
    keyDownHandler: () => {
      options.activateCurrent();
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['home'],
    scopeId: options.scopeId,
    description: 'First',
    keyDownHandler: () => {
      options.focusFirst();
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['end'],
    scopeId: options.scopeId,
    description: 'Last',
    keyDownHandler: () => {
      options.focusLast();
      return true;
    },
    hide: true,
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
