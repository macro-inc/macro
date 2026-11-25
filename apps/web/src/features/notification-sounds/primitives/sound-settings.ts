import { makePersistedState } from '@app/lib/persistence';
import {
  createUserScopedStorage,
  userScopedStorageKey,
} from '@core/util/userScopedStorage';
import { makeEventListener } from '@solid-primitives/event-listener';
import { type Accessor, createSignal } from 'solid-js';
import type { NotificationSoundCategoryId } from '../core/categories';
import type { QuietHours } from '../core/quiet-hours';
import {
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  type NotificationSoundCategorySettings,
  type NotificationSoundSettings,
  parseNotificationSoundSettings,
} from '../core/settings';

const STORAGE_KEY = 'macro:notification-sounds';
/** Per person and per device: each computer or phone chooses its own sounds. */
const STORAGE = createUserScopedStorage(STORAGE_KEY);
/** Dispatched on window when this tab saves; other tabs see a storage event. */
const SAVED_EVENT = 'macro:notification-sounds-saved';

/**
 * The saved settings, read fresh so a change made in another tab applies to
 * the next notification here.
 */
export function readNotificationSoundSettings(
  userId: string
): NotificationSoundSettings {
  return parseNotificationSoundSettings(STORAGE.read(userId));
}

/**
 * The saved settings, following saves in this tab and in other tabs, or
 * undefined while signed out.
 */
export function createSavedNotificationSoundSettings(
  userId: Accessor<string | undefined>
): Accessor<NotificationSoundSettings | undefined> {
  const [saves, setSaves] = createSignal(0);
  const saved = () => setSaves((count) => count + 1);
  makeEventListener(window, SAVED_EVENT, saved);
  makeEventListener(window, 'storage', (event) => {
    const id = userId();
    // A null key means another tab cleared storage.
    if (!id || event.key === null) return saved();
    if (event.key === userScopedStorageKey(STORAGE_KEY, id)) saved();
  });
  return () => {
    saves();
    const id = userId();
    return id ? readNotificationSoundSettings(id) : undefined;
  };
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
        write: (value) => {
          STORAGE.write(userId, JSON.stringify(value));
          // Synchronous, so a switch turned on inside a tap unlocks within it.
          window.dispatchEvent(new Event(SAVED_EVENT));
        },
      },
    }
  );

  return {
    settings,
    setEnabled: (enabled: boolean) =>
      setSettings((current) => ({ ...current, enabled })),
    setCallSoundsEnabled: (callSoundsEnabled: boolean) =>
      setSettings((current) => ({ ...current, callSoundsEnabled })),
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
    setQuietHours: (change: Partial<QuietHours>) =>
      setSettings((current) => ({
        ...current,
        quietHours: { ...current.quietHours, ...change },
      })),
  };
}
