import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError, throwOnErr } from '@core/util/result';
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
  /** Linked account identity, when the auth service exposes it. */
  username?: string;
  userId?: string;
};

type UseGithubLinkStatusQueryOptions = {
  enabled?: boolean | (() => boolean);
  refetchInterval?: number;
  refetchOnMount?: 'always';
  retryOnMount?: boolean;
};

function hasReauthenticationError(
  errors: Array<{ code: string; message?: string }>
): boolean {
  return errors.some((error) => error.code === 'REAUTHENTICATION_REQUIRED');
}

export async function fetchGithubLinkStatus(): Promise<GithubLink> {
  const response = await authServiceClient.checkGithubLinkStatus();

  if (response.isOk()) {
    // The deployed auth service can lag the identity fields in the API schema.
    const link = response.value as typeof response.value & {
      github_username?: string | null;
      github_user_id?: string | null;
    };

    return {
      status: link.reauthentication_required
        ? 'reauthentication_required'
        : 'linked',
      username: link.github_username ?? undefined,
      userId: link.github_user_id ?? undefined,
    };
  }

  if (hasReauthenticationError(response.error))
    return { status: 'reauthentication_required' };
  if (response.error.some((error) => error.code === 'NOT_FOUND'))
    return { status: 'unlinked' };
  throw new ThrownResultError(response.error);
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
      refetchInterval: options?.refetchInterval,
      refetchOnMount: options?.refetchOnMount,
      retryOnMount: options?.retryOnMount,
    };
  });
}

export async function invalidateGithubLinkStatus() {
  const options = githubLinkStatusQueryOptions();
  // A pre-OAuth request must not overwrite the newly verified connection.
  await queryClient.cancelQueries({ queryKey: options.queryKey });
  await queryClient.invalidateQueries({
    queryKey: options.queryKey,
    refetchType: 'none',
  });
  // Invalidation skips queries whose observers are all disabled (for example,
  // skipPreviewFetch mentions). Explicit fetching refreshes those readers too.
  // Keep refresh failures in query state, not in the completed OAuth result.
  return queryClient.prefetchQuery({ ...options, staleTime: 0 });
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
      fireAndForget(invalidateGithubLinkStatus(), 'github-link');
      invalidateAllSoup();
    },
  }));
}
