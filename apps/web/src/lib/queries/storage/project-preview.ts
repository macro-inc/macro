import type { DateValue } from '@core/util/date';
import { catchToResult, type ResultError } from '@core/util/result';
import { useQuery } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { previewDataLoader } from '../preview/dataloader';
import { projectsKeys } from './keys';

/** A folder with its path from the root, as a row's folder breadcrumb shows it. */
export type FolderPreview = {
  id: string;
  name: string;
  owner: string;
  /** Folder names from the root down to this folder. */
  path: string[];
  updatedAt?: DateValue | null;
};

const PROJECT_PREVIEW_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const PROJECT_PREVIEW_GC_TIME = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch a folder's preview. A list renders one breadcrumb per row, so this
 * goes through the shared preview loader, which sends the folders asked for
 * together in one request instead of one request per row.
 */
async function fetchProjectPreview(projectId: string): Promise<FolderPreview> {
  const preview = await previewDataLoader.load({
    id: projectId,
    type: 'project',
  });

  if (preview.loading || preview.access !== 'access') {
    throw new Error(`No preview for folder ${projectId}`);
  }

  if (preview.type !== 'project') {
    throw new Error(`Item ${projectId} is not a folder`);
  }

  return {
    id: preview.id,
    name: preview.name,
    owner: preview.owner ?? '',
    path: preview.path ?? [preview.name],
    updatedAt: preview.updatedAt,
  };
}

/**
 * Create query options for a project preview
 */
function projectPreviewQueryOptions(projectId: string, enabled: boolean) {
  return {
    queryKey: projectsKeys.preview(projectId).queryKey,
    queryFn: () => fetchProjectPreview(projectId),
    staleTime: PROJECT_PREVIEW_STALE_TIME,
    gcTime: PROJECT_PREVIEW_GC_TIME,
    enabled: enabled && !!projectId,
  };
}

/**
 * Hook to fetch project preview data. `enabled` lets a caller that already
 * knows the folder skip the request.
 */
export function useProjectPreviewQuery(
  projectId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => projectPreviewQueryOptions(projectId(), enabled()));
}

/**
 * Fetch and cache project preview data
 * Useful for prefetching or ensuring data is available
 */
async function _fetchAndCacheProjectPreview(
  projectId: string
): Promise<Result<{ project: FolderPreview }, ResultError<string>[]>> {
  const result = await catchToResult(async () =>
    queryClient.ensureQueryData(projectPreviewQueryOptions(projectId, true))
  );

  if (result.isErr()) {
    return err(result.error);
  }

  return ok({ project: result.value });
}

/**
 * Invalidate project preview cache
 */
function _invalidateProjectPreview(projectId: string) {
  return queryClient.invalidateQueries({
    queryKey: projectsKeys.preview(projectId).queryKey,
  });
}

/**
 * Set project preview data directly in cache
 */
function _setProjectPreviewData(projectId: string, data: FolderPreview) {
  return queryClient.setQueryData<FolderPreview>(
    projectsKeys.preview(projectId).queryKey,
    data
  );
}
