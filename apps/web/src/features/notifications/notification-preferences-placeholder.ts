export type NotificationTypePreferences = {
  disabled_types: string[];
};

export const EMPTY_NOTIFICATION_TYPE_PREFERENCES: NotificationTypePreferences =
  { disabled_types: [] };

export function notificationTypePreferencesPlaceholder(
  previous: NotificationTypePreferences | undefined
): NotificationTypePreferences {
  return previous ?? EMPTY_NOTIFICATION_TYPE_PREFERENCES;
}
