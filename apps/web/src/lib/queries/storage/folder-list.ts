import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';
import { createGraphqlFoldersQuery } from './graphql-folders';
import { useProjectsQuery } from './projects';

export type FolderRow = {
  id: string;
  name: string;
  parentId?: string | null;
  userId: string;
  createdAt?: string | null;
};

/**
 * Every folder the user can reach, from the same source as the Drive sidebar
 * so a folder open in Drive is always in the list. GraphQL `user.folders`
 * includes team folders; the REST list doesn't.
 */
export function createFolderList(): {
  folders: Accessor<FolderRow[]>;
  isPending: Accessor<boolean>;
} {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    const query = createGraphqlFoldersQuery();
    return {
      folders: () => query.data ?? [],
      isPending: () => query.isPending && !query.data,
    };
  }

  const query = useProjectsQuery();
  return {
    folders: () =>
      query.isSuccess ? query.data.filter((folder) => !folder.deletedAt) : [],
    isPending: () => query.isPending,
  };
}
