import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { initiativeClient } from '@service-storage/initiative';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { projectKeys } from './keys';

/** Authorizes native project previews without exposing backing document identity. */
export function useProjectIdentityQuery(
  id: Accessor<string>,
  userId: Accessor<string | undefined>
) {
  return useQuery(
    () => {
      const projectId = id();
      return {
        queryKey: projectKeys.identity(userId(), projectId).queryKey,
        enabled: Boolean(userId() && projectId),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          throwOnErr(() => initiativeClient.get(projectId, signal)),
        staleTime: 30_000,
        refetchInterval: 30_000,
        refetchOnWindowFocus: true,
      };
    },
    () => queryClient
  );
}
