import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  initiativeClient,
  type mapInitiativeDetail,
} from '@service-storage/initiative';
import { type QueryClient, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { TaskProjectReference } from '../core/project';
import { projectKeys } from './keys';
import { toProjectDetail } from './project-model';
import { projectProperties } from './project-properties';

type InitiativeDetail = ReturnType<typeof mapInitiativeDetail>;

const projectDetailData = (project: InitiativeDetail) => ({
  project: toProjectDetail(project),
  properties: projectProperties(project.properties),
});

/** Seeds the detail read from a create response, so opening it needs no request. */
export function seedProjectDetail(
  cache: QueryClient,
  userId: string | undefined,
  project: InitiativeDetail
) {
  cache.setQueryData(
    projectKeys.detail(userId, project.id).queryKey,
    projectDetailData(project)
  );
}

/** One authorized read backs the project view and its chips and previews. */
export function projectDetailQueryOptions(
  client: Pick<typeof initiativeClient, 'get'>,
  userId: string | undefined,
  projectId: string
) {
  return {
    queryKey: projectKeys.detail(userId, projectId).queryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      projectDetailData(await throwOnErr(() => client.get(projectId, signal))),
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

/**
 * A task's project, named only after an authorized project read; a project
 * the viewer cannot read stays unavailable. Undefined while loading.
 */
export function useTaskProjectReference(
  projectId: Accessor<string | undefined>,
  userId: Accessor<string | undefined>
): Accessor<TaskProjectReference | undefined> {
  const project = useProjectIdentityQuery(() => projectId() ?? '', userId);
  return () => {
    if (!projectId()) return { state: 'none' };
    if (project.isError) return { state: 'unavailable' };
    if (project.isPending) return undefined;
    return project.data
      ? { state: 'visible', id: project.data.id, name: project.data.name }
      : { state: 'unavailable' };
  };
}
