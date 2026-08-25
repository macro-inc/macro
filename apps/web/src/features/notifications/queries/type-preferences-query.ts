import { throwOnErr } from '@core/util/result';
import { applyPreferenceToggle } from '@notifications/apply-preference-toggle';
import { notificationTypePreferencesPlaceholder } from '@notifications/notification-preferences-placeholder';
import { queryClient } from '@queries/client';
import { notificationKeys } from '@queries/notification/keys';
import { notificationServiceClient } from '@service-notification/client';
import type { GetNotificationTypePreferencesResponse } from '@service-notification/generated/schemas/getNotificationTypePreferencesResponse';
import { useMutation, useQuery } from '@tanstack/solid-query';

const PREFERENCES_STALE_TIME = 5 * 60 * 1000;
const PREFERENCES_GC_TIME = 10 * 60 * 1000;

async function fetchNotificationTypePreferences() {
  return throwOnErr(() =>
    notificationServiceClient.getNotificationTypePreferences()
  );
}

export function createNotificationTypePreferencesQuery() {
  return useQuery(() => ({
    queryKey: notificationKeys.preferences.queryKey,
    queryFn: fetchNotificationTypePreferences,
    staleTime: PREFERENCES_STALE_TIME,
    gcTime: PREFERENCES_GC_TIME,
    placeholderData: notificationTypePreferencesPlaceholder,
  }));
}

export function createSetNotificationTypeEnabledMutation() {
  return useMutation(() => ({
    mutationFn: async (vars: { type: string; enabled: boolean }) => {
      if (vars.enabled) {
        await throwOnErr(() =>
          notificationServiceClient.enableNotificationType(vars.type)
        );
      } else {
        await throwOnErr(() =>
          notificationServiceClient.disableNotificationType(vars.type)
        );
      }
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.preferences.queryKey,
      });
      const previous =
        queryClient.getQueryData<GetNotificationTypePreferencesResponse>(
          notificationKeys.preferences.queryKey
        );
      queryClient.setQueryData<GetNotificationTypePreferencesResponse>(
        notificationKeys.preferences.queryKey,
        (current) => applyPreferenceToggle(current, vars.type, vars.enabled)
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(
        notificationKeys.preferences.queryKey,
        context?.previous
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.preferences.queryKey,
      });
    },
  }));
}
