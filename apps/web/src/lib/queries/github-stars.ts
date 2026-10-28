import { useQuery } from '@tanstack/solid-query';
import { getMacroGithubStars } from '../service-clients/service-github-public/client';

/** Shared across onboarding mounts; this public request needs no sign-in. */
export function useGithubStarsQuery() {
  return useQuery(() => ({
    queryKey: ['public', 'github', 'macro-inc/macro', 'stars'],
    queryFn: ({ signal }) => getMacroGithubStars(signal),
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
    throwOnError: false,
  }));
}
