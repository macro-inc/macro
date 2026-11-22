import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { Accessor } from 'solid-js';

/**
 * Space or Shift+V shows or hides the reading pane while Email is focused.
 * Space stands down while the reader has the keyboard, so it still scrolls
 * the open thread.
 */
export function useReadingPaneHotkey(options: {
  scopeId: string;
  enabled: Accessor<boolean>;
  readingPane: Accessor<boolean>;
  setReadingPane: (enabled: boolean) => void;
  readerHasKeyboard: Accessor<boolean>;
}) {
  registerHotkey({
    hotkey: ['space', 'shift+v'],
    hotkeyToken: TOKENS.email.toggleReadingPane,
    scopeId: options.scopeId,
    description: () =>
      options.readingPane() ? 'Hide reading pane' : 'Show reading pane',
    condition: options.enabled,
    keyDownHandler: (event) => {
      if (event?.key === ' ' && options.readerHasKeyboard()) return false;

      options.setReadingPane(!options.readingPane());
      return true;
    },
  });
}
