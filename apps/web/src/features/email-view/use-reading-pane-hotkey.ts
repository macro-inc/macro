import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { Accessor } from 'solid-js';

/** Shift+V shows or hides the reading pane while Email is focused. */
export function useReadingPaneHotkey(options: {
  scopeId: string;
  enabled: Accessor<boolean>;
  readingPane: Accessor<boolean>;
  setReadingPane: (enabled: boolean) => void;
}) {
  registerHotkey({
    hotkey: 'shift+v',
    hotkeyToken: TOKENS.email.toggleReadingPane,
    scopeId: options.scopeId,
    description: () =>
      options.readingPane() ? 'Hide reading pane' : 'Show reading pane',
    condition: options.enabled,
    keyDownHandler: () => {
      options.setReadingPane(!options.readingPane());
      return true;
    },
  });
}
