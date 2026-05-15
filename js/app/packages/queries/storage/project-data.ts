import { storageServiceClient } from '@service-storage/client';
import type { Project } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { entityKeys } from './keys';

const STALE_TIME = 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

async function fetchProjectData(projectId: string): Promise<Project> {
  const result = await storageServiceClient.projects.getProject({
    id: projectId,
  });
  if (result.isErr()) {
    throw new Error('Failed to fetch project');
  }
  return result.value.projectMetadata;
}

export function useProjectDataQuery(
  projectId: Accessor<string | undefined | null>
) {
  return useQuery(() => {
    const id = projectId();
    return {
      queryKey: id
        ? entityKeys.projectData(id).queryKey
        : entityKeys.projectData._def,
      queryFn: () => fetchProjectData(id!),
      staleTime: STALE_TIME,
      gcTime: GC_TIME,
      enabled: !!id,
    };
  });
}
