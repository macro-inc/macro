import { z } from 'zod';
import {
  type NotificationSoundCategoryId,
  notificationSoundCategory,
  soundCategoryForEvent,
} from './categories';
import {
  DEFAULT_QUIET_HOURS,
  isWithinQuietHours,
  parseQuietHours,
  type QuietHours,
} from './quiet-hours';
import {
  type CallSoundId,
  isNotificationSoundId,
  type NotificationSoundId,
} from './sounds';

export type NotificationSoundCategorySettings = {
  enabled: boolean;
  sound: NotificationSoundId;
};

export type NotificationSoundSettings = {
  /** Notification sounds are off until the person turns them on. */
  enabled: boolean;
  /** Participant cues are independent of notification sounds. */
  callSoundsEnabled: boolean;
  /** 0 to 1. */
  volume: number;
  categories: Record<
    NotificationSoundCategoryId,
    NotificationSoundCategorySettings
  >;
  /** Weekly schedule that silences sounds and desktop alerts. */
  quietHours: QuietHours;
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
  callSoundsEnabled: true,
  volume: 0.7,
  categories: categorySettings((id) => {
    const category = notificationSoundCategory(id);
    return { enabled: category.defaultEnabled, sound: category.defaultSound };
  }),
  quietHours: DEFAULT_QUIET_HOURS,
};

const storedSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  callSoundsEnabled: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  categories: z
    .record(
      z.string(),
      z.object({ enabled: z.boolean().optional(), sound: z.unknown() })
    )
    .optional(),
  quietHours: z.unknown().optional(),
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
    callSoundsEnabled: stored.callSoundsEnabled ?? defaults.callSoundsEnabled,
    volume: stored.volume ?? defaults.volume,
    quietHours: parseQuietHours(stored.quietHours),
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
  settings: NotificationSoundSettings,
  now = new Date()
): NotificationSoundId | null {
  if (isWithinQuietHours(settings.quietHours, now)) return null;
  if (!settings.enabled || settings.volume === 0) return null;
  const categoryId = soundCategoryForEvent(eventTag);
  if (!categoryId) return null;
  const category = settings.categories[categoryId];
  return category.enabled ? category.sound : null;
}

/** The participant cue to play, independent of notification sound categories. */
export function soundForCallEvent(
  event: 'join' | 'leave',
  settings: NotificationSoundSettings,
  now = new Date()
): CallSoundId | null {
  if (!settings.callSoundsEnabled || settings.volume === 0) return null;
  if (isWithinQuietHours(settings.quietHours, now)) return null;
  return event === 'join' ? 'call-join' : 'call-leave';
}
