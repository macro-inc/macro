import { z } from 'zod';
import {
  type NotificationSoundCategoryId,
  notificationSoundCategory,
  soundCategoryForEvent,
} from './categories';
import { isNotificationSoundId, type NotificationSoundId } from './sounds';

export type NotificationSoundCategorySettings = {
  enabled: boolean;
  sound: NotificationSoundId;
};

export type NotificationSoundSettings = {
  /** Master switch; sounds are off until the person turns them on. */
  enabled: boolean;
  /** 0 to 1. */
  volume: number;
  categories: Record<
    NotificationSoundCategoryId,
    NotificationSoundCategorySettings
  >;
};

function categorySettings(
  settingsFor: (
    id: NotificationSoundCategoryId
  ) => NotificationSoundCategorySettings
): NotificationSoundSettings['categories'] {
  return {
    messages: settingsFor('messages'),
    mentions: settingsFor('mentions'),
    replies: settingsFor('replies'),
    email: settingsFor('email'),
    meetings: settingsFor('meetings'),
    tasks: settingsFor('tasks'),
    agents: settingsFor('agents'),
    other: settingsFor('other'),
  };
}

/** Notifications arriving closer together than this share one sound. */
export const NOTIFICATION_SOUND_MIN_GAP_MS = 1_500;

export const DEFAULT_NOTIFICATION_SOUND_SETTINGS: NotificationSoundSettings = {
  enabled: false,
  volume: 0.7,
  categories: categorySettings((id) => {
    const category = notificationSoundCategory(id);
    return { enabled: category.defaultEnabled, sound: category.defaultSound };
  }),
};

const storedSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  categories: z
    .record(
      z.string(),
      z.object({ enabled: z.boolean().optional(), sound: z.unknown() })
    )
    .optional(),
});

/**
 * Reads saved settings, keeping each valid field and defaulting the rest, so
 * a category or sound added or removed later never discards the others.
 */
export function parseNotificationSoundSettings(
  raw: string | null
): NotificationSoundSettings {
  if (!raw) return DEFAULT_NOTIFICATION_SOUND_SETTINGS;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return DEFAULT_NOTIFICATION_SOUND_SETTINGS;
  }
  const parsed = storedSettingsSchema.safeParse(json);
  if (!parsed.success) return DEFAULT_NOTIFICATION_SOUND_SETTINGS;

  const defaults = DEFAULT_NOTIFICATION_SOUND_SETTINGS;
  const stored = parsed.data;
  return {
    enabled: stored.enabled ?? defaults.enabled,
    volume: stored.volume ?? defaults.volume,
    categories: categorySettings((id) => {
      const saved = stored.categories?.[id];
      const sound = saved?.sound;
      return {
        enabled: saved?.enabled ?? defaults.categories[id].enabled,
        sound: isNotificationSoundId(sound)
          ? sound
          : defaults.categories[id].sound,
      };
    }),
  };
}

/**
 * The sound a notification should make, or null when it should stay quiet:
 * sounds are off, its category is off, or it is not a sound-making event.
 */
export function soundForNotification(
  eventTag: string,
  settings: NotificationSoundSettings
): NotificationSoundId | null {
  if (!settings.enabled || settings.volume === 0) return null;
  const categoryId = soundCategoryForEvent(eventTag);
  if (!categoryId) return null;
  const category = settings.categories[categoryId];
  return category.enabled ? category.sound : null;
}
