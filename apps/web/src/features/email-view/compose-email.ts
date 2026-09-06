import { runCreateAction } from '@app/features/command/Launcher';

/**
 * Opens a new email compose from the Email view, the same way the legacy
 * mail toolbar's create button does (in the split, focusing the To field).
 */
export function composeEmail() {
  runCreateAction('email', { source: 'email_view' });
}
