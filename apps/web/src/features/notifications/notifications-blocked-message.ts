import { t } from '@app/lib/i18n';
import { isTauri } from '@core/util/platform';
import { type as osType } from '@tauri-apps/plugin-os';

/** Tells the user where to allow notifications after a request ends without permission. */
export function notificationsBlockedMessage(): string {
  return isTauri() && osType() === 'macos'
    ? t('settingsNotifications.blockedMacos')
    : t('settingsNotifications.blocked');
}
