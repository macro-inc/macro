import { createUrqlQuery, type UrqlQueryResult } from '@app/lib/urql-solid';
import {
  DriveFoldersDocument,
  type DriveFoldersQuery,
  type DriveFoldersQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { onCleanup } from 'solid-js';

/** Folder row returned by the GraphQL `user.folders` query. */
export type GraphqlDriveFolder = {
  id: string;
  name: string;
  parentId: string | null;
  userId: string;
};

type GraphqlFoldersQuery = UrqlQueryResult<
  GraphqlDriveFolder[],
  DriveFoldersQueryVariables,
  DriveFoldersQuery
>;

const activeFolderQueries = new Set<GraphqlFoldersQuery>();

function selectFolders(data: DriveFoldersQuery): GraphqlDriveFolder[] {
  return data.user.folders
    .filter((folder) => !folder.deletedAt)
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? null,
      userId: folder.ownerId,
    }));
}

/** Live urql-solid folders query for the Drive sidebar. */
export function createGraphqlFoldersQuery(): GraphqlFoldersQuery {
  const query = createUrqlQuery<
    DriveFoldersQuery,
    DriveFoldersQueryVariables,
    GraphqlDriveFolder[]
  >(() => ({
    query: DriveFoldersDocument,
    client: getGraphqlSoupClient(),
    variables: {},
    requestPolicy: 'cache-and-network',
    keepPreviousData: false,
    select: selectFolders,
  }));

  activeFolderQueries.add(query);
  onCleanup(() => activeFolderQueries.delete(query));
  return query;
}

/** Refetch every mounted GraphQL folders query (e.g. after local create). */
export async function refreshActiveGraphqlFoldersQueries(): Promise<void> {
  await Promise.all(
    [...activeFolderQueries].map((query) =>
      query.refetch({ requestPolicy: 'cache-and-network' })
    )
  );
}
