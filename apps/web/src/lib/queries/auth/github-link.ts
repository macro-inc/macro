import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { authServiceClient } from '@service-auth/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { authKeys } from './keys';

const GITHUB_LINK_STATUS_STALE_TIME = 5 * 60 * 1000;

export type GithubLinkStatus =
  | 'linked'
  | 'unlinked'
  | 'reauthentication_required';

export type GithubLink = {
  status: GithubLinkStatus;
  // Populated once auth-service includes the linked account handle on
  // /link/github/status.
  username?: string;
};

type UseGithubLinkStatusQueryOptions = {
  enabled?: boolean | (() => boolean);
};

function hasReauthenticationError(
  errors: Array<{ code: string; message?: string }>
): boolean {
  return errors.some((error) => error.code === 'REAUTHENTICATION_REQUIRED');
}

export async function fetchGithubLinkStatus(): Promise<GithubLink> {
  const response = await authServiceClient.checkGithubLinkStatus();

  if (response.isOk()) {
    const username =
      (response.value as { github_username?: string | null }).github_username ??
      undefined;

    return {
      status: response.value.reauthentication_required
        ? 'reauthentication_required'
        : 'linked',
      username,
    };
  }

  return {
    status: hasReauthenticationError(response.error)
      ? 'reauthentication_required'
      : 'unlinked',
  };
}

export function githubLinkStatusQueryOptions() {
  return {
    queryKey: authKeys.githubLinkStatus.queryKey,
    queryFn: fetchGithubLinkStatus,
    staleTime: GITHUB_LINK_STATUS_STALE_TIME,
    refetchOnWindowFocus: 'always' as const,
  };
}

export function useGithubLinkStatusQuery(
  options?: UseGithubLinkStatusQueryOptions
) {
  return useQuery(() => {
    const enabled =
      typeof options?.enabled === 'function'
        ? options.enabled()
        : (options?.enabled ?? true);

    return {
      ...githubLinkStatusQueryOptions(),
      enabled,
    };
  });
}

export function invalidateGithubLinkStatus() {
  return queryClient.invalidateQueries({
    queryKey: authKeys.githubLinkStatus.queryKey,
  });
}

export function useInitGithubLinkMutation() {
  return useMutation(() => ({
    mutationFn: async (originalUrl?: string) =>
      await throwOnErr(() => authServiceClient.initGithubLink(originalUrl)),
  }));
}

export function useReauthenticateGithubMutation() {
  return useMutation(() => ({
    mutationFn: async (originalUrl?: string) =>
      await throwOnErr(() =>
        authServiceClient.reauthenticateGithub(originalUrl)
      ),
  }));
}

export function useDeleteGithubLinkMutation() {
  return useMutation(() => ({
    mutationFn: async () =>
      await throwOnErr(() => authServiceClient.deleteGithubLink()),
    onSuccess: () => {
      invalidateGithubLinkStatus();
      invalidateAllSoup();
    },
  }));
}
