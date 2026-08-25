import { throwOnErr } from '@core/util/result';
import { applyPreferenceToggle } from '@notifications/apply-preference-toggle';
import { EMPTY_NOTIFICATION_TYPE_PREFERENCES } from '@notifications/notification-preferences-placeholder';
import { queryClient } from '@queries/client';
import { notificationKeys } from '@queries/notification/keys';
import { notificationServiceClient } from '@service-notification/client';
import type { GetNotificationTypePreferencesResponse } from '@service-notification/generated/schemas/getNotificationTypePreferencesResponse';
import { createSignal, onMount } from 'solid-js';

async function fetchNotificationTypePreferences() {
  return throwOnErr(() =>
    notificationServiceClient.getNotificationTypePreferences()
  );
}

function writePreferencesCache(next: GetNotificationTypePreferencesResponse) {
  queryClient.setQueryData(notificationKeys.preferences.queryKey, next);
}

/**
 * Preferences for the settings page. Not a Solid Query hook.
 * `useQuery` is a `createResource`; Settings and the split panel wrap
 * this tab in empty Suspense, so a cache write after a toggle remounts
 * the page. Keep the list in a signal instead.
 */
export function createNotificationTypePreferences() {
  const cached =
    queryClient.getQueryData<GetNotificationTypePreferencesResponse>(
      notificationKeys.preferences.queryKey
    );
  const [data, setData] = createSignal(
    cached ?? EMPTY_NOTIFICATION_TYPE_PREFERENCES
  );
  const [loading, setLoading] = createSignal(cached === undefined);

  onMount(() => {
    void fetchNotificationTypePreferences()
      .then((next) => {
        setData(next);
        writePreferencesCache(next);
      })
      .finally(() => setLoading(false));
  });

  const setTypeEnabled = async (type: string, enabled: boolean) => {
    const previous = data();
    const next = applyPreferenceToggle(previous, type, enabled);
    setData(next);
    writePreferencesCache(next);
    try {
      if (enabled) {
        await throwOnErr(() =>
          notificationServiceClient.enableNotificationType(type)
        );
      } else {
        await throwOnErr(() =>
          notificationServiceClient.disableNotificationType(type)
        );
      }
    } catch (error) {
      setData(previous);
      writePreferencesCache(previous);
      throw error;
    }
  };

  return { data, loading, setTypeEnabled };
}
