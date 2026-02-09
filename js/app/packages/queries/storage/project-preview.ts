import { SERVER_HOSTS } from '@core/constant/servers';
import {
  catchToResult,
  isErr,
  ok,
  type MaybeResult,
} from '@core/util/maybeResult';
import type {
  GetBatchProjectPreviewResponse,
  ProjectPreviewData,
} from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { projectsKeys } from './keys';

const PROJECT_PREVIEW_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const PROJECT_PREVIEW_GC_TIME = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch project preview data from the storage service
 */
async function fetchProjectPreview(
  projectId: string
): Promise<ProjectPreviewData> {
  const dssHost = SERVER_HOSTS['document-storage-service'];
  const apiVersion = 'v2';
  const url = `${dssHost}/${apiVersion}/projects/preview`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({
      projectIds: [projectId],
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch project preview: ${response.statusText}`);
  }

  const json = (await response.json()) as GetBatchProjectPreviewResponse;

  const projectPreview = json.previews.find(
    (preview) => preview.id === projectId
  );

  if (!projectPreview) {
    throw new Error(`Project ${projectId} not found in preview response`);
  }

  if (projectPreview.access === 'no_access') {
    throw new Error(`No access to folder ${projectId}`);
  }

  if (projectPreview.access === 'does_not_exist') {
    throw new Error(`Project ${projectId} does not exist`);
  }

  return projectPreview;
}

/**
 * Create query options for a project preview
 */
function projectPreviewQueryOptions(projectId: string) {
  return {
    queryKey: projectsKeys.preview(projectId).queryKey,
    queryFn: () => fetchProjectPreview(projectId),
    staleTime: PROJECT_PREVIEW_STALE_TIME,
    gcTime: PROJECT_PREVIEW_GC_TIME,
    enabled: !!projectId,
  };
}

/**
 * Hook to fetch project preview data
 */
export function useProjectPreviewQuery(projectId: Accessor<string>) {
  return useQuery(() => projectPreviewQueryOptions(projectId()));
}

/**
 * Fetch and cache project preview data
 * Useful for prefetching or ensuring data is available
 */
export async function fetchAndCacheProjectPreview(
  projectId: string
): Promise<MaybeResult<string, { project: ProjectPreviewData }>> {
  const result = await catchToResult(async () =>
    queryClient.ensureQueryData(projectPreviewQueryOptions(projectId))
  );

  if (isErr(result)) {
    return result;
  }

  return ok({ project: result[1] });
}

/**
 * Invalidate project preview cache
 */
export function invalidateProjectPreview(projectId: string) {
  return queryClient.invalidateQueries({
    queryKey: projectsKeys.preview(projectId).queryKey,
  });
}

/**
 * Set project preview data directly in cache
 */
export function setProjectPreviewData(
  projectId: string,
  data: ProjectPreviewData
) {
  return queryClient.setQueryData<ProjectPreviewData>(
    projectsKeys.preview(projectId).queryKey,
    data
  );
}
