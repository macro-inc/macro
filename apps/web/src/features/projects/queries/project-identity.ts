import type { OptimisticResponse } from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { createQueryAuthorization } from '@queries/authorization';
import {
  InitiativeDocument,
  InitiativeIdentityDocument,
  type InitiativeIdentityQuery,
  type InitiativeQuery,
  type InitiativeQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import {
  mapInitiativeDetail,
  mapInitiativeIdentity,
} from '@service-storage/initiative';
import { type Client, type DocumentInput, stringifyDocument } from '@urql/core';
import { type Accessor, createMemo } from 'solid-js';
import type { ProjectIdentity } from '../core/project';
import { toProjectDetail } from './project-model';
import { projectProperties } from './project-properties';
import { registerProjectRevalidation } from './project-revalidation';

type InitiativeDetail = ReturnType<typeof mapInitiativeDetail>;

export const projectDetailData = (project: InitiativeDetail) => ({
  project: toProjectDetail(project),
  properties: projectProperties(project.properties),
});

/** Seeds the detail and identity reads from a create response, so neither needs a request. */
export async function seedProjectDetail(
  userId: string | undefined,
  project: InitiativeDetail,
  host?: Pick<CacheHost, 'writeQuery' | 'disabled'>
) {
  if (!host || host.disabled || !userId) return;
  // The create response already normalized the complete record. Establish its
  // query edges without copying a second snapshot over those live fields.
  const data = {
    user: {
      id: userId,
      initiative: { __typename: 'GraphqlSoupInitiative', id: project.id },
    },
  } satisfies OptimisticResponse<InitiativeQuery> &
    OptimisticResponse<InitiativeIdentityQuery>;
  try {
    await Promise.all(
      [
        { document: InitiativeDocument, operationName: 'Initiative' },
        {
          document: InitiativeIdentityDocument,
          operationName: 'InitiativeIdentity',
        },
      ].map(({ document, operationName }) =>
        host.writeQuery({
          query: stringifyDocument(document),
          operationName,
          variables: { initiativeId: project.id },
          data,
        })
      )
    );
  } catch (error) {
    console.warn(
      'Created project could not be seeded in the local cache',
      error
    );
  }
}

function createAuthorizedProjectQuery<
  QueryData extends { user: { id: string } },
  Result,
>(
  document: DocumentInput<QueryData, InitiativeQueryVariables>,
  select: (data: QueryData) => Result,
  client: () => Client,
  userId: Accessor<string | undefined>,
  projectId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  const active = () => enabled() && Boolean(userId() && projectId());
  const authorization = createQueryAuthorization(() =>
    JSON.stringify([userId(), projectId()])
  );
  const query = createLiveQuery(
    document,
    () => (active() ? { initiativeId: projectId() } : undefined),
    () => ({
      client: client(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      onResult: authorization.onResult,
      select: (data) => ({ viewerId: data.user.id, value: select(data) }),
    })
  );
  registerProjectRevalidation(client, active, () =>
    query.refetch({ requestPolicy: 'cache-and-network' })
  );
  const data = createMemo(() => {
    const result = query.data;
    if (
      !active() ||
      authorization.error() ||
      !result ||
      result.viewerId !== userId()
    )
      return undefined;
    return result.value;
  });
  return {
    get data() {
      return data();
    },
    get error() {
      return active() ? (authorization.error() ?? query.error) : null;
    },
    get isSuccess() {
      return (
        active() &&
        !authorization.error() &&
        query.isSuccess &&
        query.data?.viewerId === userId()
      );
    },
    get isPending() {
      return !active() || query.isPending;
    },
    get isError() {
      return active() && Boolean(authorization.error() || query.isError);
    },
    refetch: query.refetch,
  };
}

/** The project view's read: counts, task ids, members, sharing, and properties. */
export function createProjectDetailQuery(
  client: () => Client,
  userId: Accessor<string | undefined>,
  projectId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  return createAuthorizedProjectQuery(
    InitiativeDocument,
    (data) => projectDetailData(mapInitiativeDetail(data.user.initiative)),
    client,
    userId,
    projectId,
    enabled
  );
}

/** Chips, previews, and labels read only id, name, and the viewer's access. */
export function createProjectIdentityQuery(
  client: () => Client,
  userId: Accessor<string | undefined>,
  projectId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  return createAuthorizedProjectQuery(
    InitiativeIdentityDocument,
    (data): ProjectIdentity => {
      const project = mapInitiativeIdentity(data.user.initiative);
      return {
        id: project.id,
        name: project.name,
        access: project.userAccessLevel,
      };
    },
    client,
    userId,
    projectId,
    enabled
  );
}

/** Authorizes native project previews without exposing backing document identity. */
export function useProjectIdentityQuery(
  id: Accessor<string>,
  userId: Accessor<string | undefined>
) {
  return createProjectIdentityQuery(getGraphqlSoupClient, userId, id);
}
