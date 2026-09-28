import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { initiativeClient } from '@service-storage/initiative';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { projectKeys } from './keys';
import { toProjectDetail } from './project-model';
import { projectProperties } from './project-properties';

/** One authorized read backs the project view and its chips and previews. */
export function projectDetailQueryOptions(
  client: Pick<typeof initiativeClient, 'get'>,
  userId: string | undefined,
  projectId: string
) {
  return {
    queryKey: projectKeys.detail(userId, projectId).queryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const project = await throwOnErr(() => client.get(projectId, signal));
      return {
        project: toProjectDetail(project),
        properties: projectProperties(project.properties),
      };
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  };
}

/** Authorizes native project previews without exposing backing document identity. */
export function useProjectIdentityQuery(
  id: Accessor<string>,
  userId: Accessor<string | undefined>
) {
  return useQuery(
    () => ({
      ...projectDetailQueryOptions(initiativeClient, userId(), id()),
      enabled: Boolean(userId() && id()),
      select: (data: { project: { id: string; name: string } }) => data.project,
    }),
    () => queryClient
  );
}
