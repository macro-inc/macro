import type { GetNotificationTypePreferencesResponse } from '@service-notification/generated/schemas/getNotificationTypePreferencesResponse';

export function applyPreferenceToggle(
  current: GetNotificationTypePreferencesResponse | undefined,
  type: string,
  enabled: boolean
): GetNotificationTypePreferencesResponse {
  const disabled = new Set(current?.disabled_types ?? []);
  if (enabled) {
    disabled.delete(type);
  } else {
    disabled.add(type);
  }
  return { disabled_types: [...disabled] };
}
