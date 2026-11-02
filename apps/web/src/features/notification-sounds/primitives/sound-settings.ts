import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import type { NotificationSoundCategoryId } from '../core/categories';
import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  type NotificationSoundCategorySettings,
  type NotificationSoundSettings,
  parseNotificationSoundSettings,
} from '../core/settings';

/** Per person and per device: each computer or phone chooses its own sounds. */
const STORAGE = createUserScopedStorage('macro:notification-sounds');

/**
 * The saved settings, read fresh so a change made in another tab applies to
 * the next notification here.
 */
export function readNotificationSoundSettings(
  userId: string
): NotificationSoundSettings {
  return parseNotificationSoundSettings(STORAGE.read(userId));
}

/** Editable sound settings for the settings page. */
export function createNotificationSoundSettings(userId: string) {
  const [settings, setSettings] = makePersistedState(
    createSignal<NotificationSoundSettings>(
      DEFAULT_NOTIFICATION_SOUND_SETTINGS
    ),
    {
      storages: {
        restore: () => readNotificationSoundSettings(userId),
        write: (value) => STORAGE.write(userId, JSON.stringify(value)),
      },
    }
  );

  return {
    settings,
    setEnabled: (enabled: boolean) =>
      setSettings((current) => ({ ...current, enabled })),
    setVolume: (volume: number) =>
      setSettings((current) => ({ ...current, volume })),
    setCategory: (
      id: NotificationSoundCategoryId,
      change: Partial<NotificationSoundCategorySettings>
    ) =>
      setSettings((current) => ({
        ...current,
        categories: {
          ...current.categories,
          [id]: { ...current.categories[id], ...change },
        },
      })),
  };
}
