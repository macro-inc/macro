import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { Accessor } from 'solid-js';

type RecipientField = {
  reveal: () => void;
  input: () => HTMLElement | undefined;
};

/**
 * Cmd+Shift+C and Cmd+Shift+B reveal and focus the Cc and Bcc fields. Each
 * composer registers them on its own scope, because the enclosing split binds
 * the same keys to Copy link and Copy branch name.
 */
export function registerCcBccHotkeys(options: {
  scopeId: string;
  disabled: Accessor<boolean>;
  cc: RecipientField;
  bcc: RecipientField;
}) {
  const edit = (field: RecipientField) => () => {
    if (options.disabled()) return false;
    field.reveal();
    // The field mounts on reveal; focus it once its input ref is set.
    queueMicrotask(() => field.input()?.focus());
    return true;
  };
  registerHotkey({
    hotkey: 'shift+cmd+c',
    scopeId: options.scopeId,
    description: 'Edit "Cc" recipients',
    keyDownHandler: edit(options.cc),
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.ccRecipients,
    shouldReturnFocusOnClose: false,
  });
  registerHotkey({
    hotkey: 'shift+cmd+b',
    scopeId: options.scopeId,
    description: 'Edit "Bcc" recipients',
    keyDownHandler: edit(options.bcc),
    runWithInputFocused: true,
    hotkeyToken: TOKENS.email.compose.edit.bccRecipients,
    shouldReturnFocusOnClose: false,
  });
}
