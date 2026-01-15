import { SERVER_HOSTS } from '@core/constant/servers';
import type { WithRequired } from '@core/util/withRequired';
import type {
  GetBatchProjectPreviewResponse,
  ProjectPreviewData,
} from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import {
  type ChatEntity,
  type DocumentEntity,
  type EntityData,
  getEntityProjectId,
  type ProjectEntity,
} from '../types/entity';
import {
  createApiTokenQuery,
  handleFetchResponse,
  withApiTokenRetry,
} from './auth';
import { queryKeys } from './key';

export type ProjectContainedEntity = WithRequired<
  Extract<EntityData, DocumentEntity | ChatEntity | ProjectEntity>,
  'projectId'
>;

export const isProjectContainedEntity = (
  entity: EntityData
): entity is ProjectContainedEntity => {
  return getEntityProjectId(entity) !== false;
};

const fetchProjectData = async (
  projectId: string,
  apiToken?: string
): Promise<ProjectPreviewData> => {
  if (!apiToken) throw new Error('No API token provided');

  const dssHost = SERVER_HOSTS['document-storage-service'];
  const apiVersion = 'v2';
  const url = `${dssHost}/${apiVersion}/projects/preview`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectIds: [projectId],
    }),
  });

  await handleFetchResponse(response, 'Failed to fetch project');

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
};

export function createProjectQuery(projectId: string) {
  const authQuery = createApiTokenQuery();

  const projectQuery = useQuery(() => {
    return {
      queryKey: queryKeys.project({
        projectId,
      }),
      queryFn: () =>
        withApiTokenRetry(authQuery, (apiToken) =>
          fetchProjectData(projectId, apiToken)
        ),
      enabled: authQuery.isSuccess && !!projectId,
      gcTime: 1000 * 60 * 10, // 10 minutes
      staleTime: 1000 * 60 * 5, // 5 minutes
    };
  });

  return projectQuery;
}
