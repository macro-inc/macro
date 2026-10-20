import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type { Language } from '@service-auth/generated/schemas/language';
import type { UserLanguage } from '@service-auth/generated/schemas/userLanguage';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { authKeys } from './keys';

function userLanguageQueryOptions() {
  return queryOptions({
    queryKey: authKeys.userLanguage.queryKey,
    queryFn: () => throwOnErr(() => authServiceClient.getUserLanguage()),
  });
}

/** The interface language the current user picked; `null` follows the team. */
export function useUserLanguageQuery() {
  return useQuery(userLanguageQueryOptions);
}

/** Sets the user's own language, or clears it (`null`) to follow the team. */
export function useSetUserLanguageMutation() {
  return useMutation(() => ({
    mutationFn: (language: Language | null) =>
      throwOnErr(() => authServiceClient.putUserLanguage({ language })),
    onMutate: async (language) => {
      await queryClient.cancelQueries({
        queryKey: authKeys.userLanguage.queryKey,
      });
      const previous = queryClient.getQueryData<UserLanguage>(
        authKeys.userLanguage.queryKey
      );
      queryClient.setQueryData<UserLanguage>(authKeys.userLanguage.queryKey, {
        language,
      });
      return { previous };
    },
    onError: (_error, _language, context) => {
      queryClient.setQueryData(
        authKeys.userLanguage.queryKey,
        context?.previous
      );
      toast.failure(t('settingsLanguage.updateFailed'));
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: authKeys.userLanguage.queryKey,
      }),
  }));
}
