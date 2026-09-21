import { analytics } from '@app/lib/analytics';
import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { teamKeys } from './keys';

/** Identity-scoped and never persisted. A failed read must not authorize telemetry. */
export function useWorkspacePrivacyQuery() {
  const userId = useUserId();
  return useQuery(() => ({
    queryKey: teamKeys.privacy(userId() ?? '').queryKey,
    enabled: !!userId(),
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.getWorkspacePrivacy()),
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always' as const,
    throwOnError: false,
    retry: false,
    meta: { persist: false },
  }));
}

export function useSetWorkspacePrivacyMutation() {
  const userId = useUserId();
  return useMutation(() => ({
    mutationFn: async (request: {
      enabled: boolean;
      expected_revision: number;
    }) => {
      // Stop this tab before the request, including when the server later rejects it.
      // Only a fresh page may re-enable providers after a privacy transition.
      if (request.enabled) analytics.setPrivacyPermission(false);
      return await throwOnErr(() =>
        authServiceClient.setWorkspacePrivacy(request)
      );
    },
    onSuccess: (status) => {
      queryClient.setQueryData(
        teamKeys.privacy(userId() ?? '').queryKey,
        status
      );
      window.location.reload();
    },
  }));
}
