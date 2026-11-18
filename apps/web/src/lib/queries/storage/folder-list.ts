import type { Accessor } from 'solid-js';
import { createGraphqlFoldersQuery } from './graphql-folders';

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
 * includes team folders.
 */
export function createFolderList(): {
  folders: Accessor<FolderRow[]>;
  isPending: Accessor<boolean>;
} {
  const query = createGraphqlFoldersQuery();
  return {
    folders: () => query.data ?? [],
    isPending: () => query.isPending && !query.data,
  };
}
