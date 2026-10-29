import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { openFilePicker } from '@core/util/filePicker';
import type { Accessor } from 'solid-js';

/**
 * Mail-client draft shortcuts. Cmd+Shift+. and Cmd+Shift+, (Superhuman) and
 * Cmd+Shift+D (Gmail) discard the draft; Cmd+Shift+U attaches files. Each
 * composer registers them on its own scope so a reply and a standalone draft
 * act only on themselves.
 */
export function registerDraftActionHotkeys(options: {
  scopeId: string;
  disabled: Accessor<boolean>;
  discard: () => void;
  /** Omit when the composer takes no attachments. */
  attach?: (files: File[]) => void;
}) {
  registerHotkey({
    hotkey: ['shift+cmd+.', 'shift+cmd+,', 'shift+cmd+d'],
    scopeId: options.scopeId,
    description: 'Discard draft',
    keyDownHandler: () => {
      if (options.disabled()) return false;
      options.discard();
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.discardDraft,
    shouldReturnFocusOnClose: false,
  });

  const attach = options.attach;
  if (!attach) return;
  registerHotkey({
    hotkey: 'shift+cmd+u',
    scopeId: options.scopeId,
    description: 'Attach files',
    keyDownHandler: () => {
      if (options.disabled()) return false;
      openFilePicker({ multiple: true }, attach);
      return true;
    },
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.attach,
    shouldReturnFocusOnClose: false,
  });
}
