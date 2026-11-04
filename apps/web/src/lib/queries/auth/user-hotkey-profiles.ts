import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type { UserHotkeyProfiles } from '@service-auth/generated/schemas/userHotkeyProfiles';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { authKeys } from './keys';

function userHotkeyProfilesQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: authKeys.userHotkeyProfiles.queryKey,
    queryFn: () => throwOnErr(() => authServiceClient.getUserHotkeyProfiles()),
    enabled,
  });
}

/** The keyboard shortcut profile the current user turned on for each view. */
export function useUserHotkeyProfilesQuery(enabled: Accessor<boolean>) {
  return useQuery(() => userHotkeyProfilesQueryOptions(enabled()));
}

/** Replaces the user's profile choices, on every device. */
export function useSetUserHotkeyProfilesMutation() {
  return useMutation(() => ({
    mutationFn: (profiles: UserHotkeyProfiles) =>
      throwOnErr(() => authServiceClient.putUserHotkeyProfiles(profiles)),
    onMutate: async (profiles) => {
      await queryClient.cancelQueries({
        queryKey: authKeys.userHotkeyProfiles.queryKey,
      });
      const previous = queryClient.getQueryData<UserHotkeyProfiles>(
        authKeys.userHotkeyProfiles.queryKey
      );
      queryClient.setQueryData<UserHotkeyProfiles>(
        authKeys.userHotkeyProfiles.queryKey,
        profiles
      );
      return { previous };
    },
    onError: (_error, _profiles, context) => {
      queryClient.setQueryData(
        authKeys.userHotkeyProfiles.queryKey,
        context?.previous
      );
      toast.failure(t('hotkeyProfiles.updateFailed'));
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: authKeys.userHotkeyProfiles.queryKey,
      }),
  }));
}
