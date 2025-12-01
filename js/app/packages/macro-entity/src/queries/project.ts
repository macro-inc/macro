import { SERVER_HOSTS } from '@core/constant/servers';
import type { WithRequired } from '@core/util/withRequired';
import type {
  GetBatchProjectPreviewResponse,
  ProjectPreviewData,
} from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { ChatEntity, DocumentEntity, EntityData } from '../types/entity';
import { createApiTokenQuery } from './auth';
import { queryKeys } from './key';

export type ProjectContainedEntity = WithRequired<
  Extract<EntityData, DocumentEntity | ChatEntity>,
  'projectId'
>;

export const isProjectContainedEntity = (
  entity: EntityData
): entity is ProjectContainedEntity => {
  if (entity.type !== 'chat' && entity.type !== 'document') return false;
  return !!entity.projectId;
};

const fetchProjectData = async (
  projectId: string,
  apiToken?: string
): Promise<ProjectPreviewData> => {
  if (!apiToken) throw new Error('No API token provided');

  const dssHost = SERVER_HOSTS['document-storage-service'];
  const apiVersion = 'v2';
  const url = `${dssHost}/${apiVersion}/projects/preview`;

  try {
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Fetch failed:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        url,
        projectId,
        tokenLength: apiToken.length,
      });

      // If it's a 401, let's try to decode the token to see if it's valid
      if (response.status === 401) {
        try {
          const parts = apiToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(
              atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
            );
            console.log('Token payload:', payload);
          }
        } catch (e) {
          console.log('Could not decode token:', e);
        }
      }

      throw new Error(
        `Failed to fetch project: ${response.status} ${response.statusText}`,
        { cause: response }
      );
    }

    const json = (await response.json()) as GetBatchProjectPreviewResponse;

    // Find the preview for our specific project ID
    const projectPreview = json.previews.find(
      (preview) => preview.id === projectId
    );

    if (!projectPreview) {
      throw new Error(`Project ${projectId} not found in preview response`);
    }

    // Check access level
    if (projectPreview.access === 'no_access') {
      throw new Error(`No access to folder ${projectId}`);
    }

    if (projectPreview.access === 'does_not_exist') {
      throw new Error(`Project ${projectId} does not exist`);
    }

    return projectPreview;
    // Return the project metadata in the expected format
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }
};

export function createProjectQuery<T extends ProjectContainedEntity>(
  entity: T
) {
  const authQuery = createApiTokenQuery();

  const projectQuery = useQuery(() => ({
    queryKey: queryKeys.project({ projectId: entity.projectId }),
    queryFn: () => fetchProjectData(entity.projectId, authQuery.data),
    enabled: authQuery.isSuccess,
    gcTime: 1000 * 60 * 10, // 10 minutes
    staleTime: 1000 * 60 * 5, // 5 minutes
  }));

  return projectQuery;
}
