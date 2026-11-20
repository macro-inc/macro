import { analytics } from '@app/lib/analytics';
import { fireAndForget } from '@core/util/fireAndForget';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { refetchHistory } from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { storageServiceClient } from '@service-storage/client';
import { refreshActiveGraphqlFoldersQueries } from './graphql-folders';

/** Creates a project and refreshes the lists that show it. */
export async function createProject(params: {
  name: string;
  parentId?: string;
  sharePermission?: null;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
}): Promise<string | undefined> {
  const generation = cacheSessionGeneration.capture();
  const result = await storageServiceClient.projects.create({
    name: params.name,
    projectParentId: params.parentId,
    sharePermission: params.sharePermission,
  });

  if (result.isOk()) {
    const projectId = result.value.id;
    if (!cacheSessionGeneration.isCurrent(generation)) return projectId;
    analytics.track('create_entity', {
      entityType: 'project',
      entityId: projectId,
      parentId: params.parentId,
      source: params.source,
    });
    setPreviewOnCreate({
      generation,
      itemId: projectId,
      itemType: 'project',
      name: params.name,
    });
    await storageServiceClient.upsertItemToUserHistory({
      itemId: projectId,
      itemType: 'project',
    });
    // Drive's folder contents are a Soup list, not the projects list: insert
    // the new folder there too so it appears in its parent without a reload.
    fireAndForget(
      refetchSoupEntity(projectId, 'project', {
        ownTouch: true,
        refreshGraphql: true,
      }),
      'project-creation'
    );
    await Promise.all([refreshActiveGraphqlFoldersQueries(), refetchHistory()]);
    return projectId;
  }

  return undefined;
}
