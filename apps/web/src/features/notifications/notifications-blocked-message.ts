import { isTauri } from '@core/util/platform';
import { type as osType } from '@tauri-apps/plugin-os';

/** Tells the user where to allow notifications after a request ends without permission. */
export function notificationsBlockedMessage(): string {
  return isTauri() && osType() === 'macos'
    ? 'Open System Settings → Notifications → Macro and turn on Allow notifications.'
    : 'Allow notification permissions, then try again.';
}
