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
import { type Accessor, createComputed, createMemo, on } from 'solid-js';
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

type AuthorizedRead<Result> = { viewerId: string; value: Result };

// A virtualized list mounts the same project's header and cells again on
// every scroll; the last answer for a viewer and project is served on mount
// so those remounts neither request again nor show a loading state.
const lastKnownReads = new Map<string, Map<string, AuthorizedRead<unknown>>>();

function lastKnownReadsFor(documentKey: string) {
  let reads = lastKnownReads.get(documentKey);
  if (!reads) {
    reads = new Map();
    lastKnownReads.set(documentKey, reads);
  }
  return reads;
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
  enabled: Accessor<boolean>,
  requestPolicy: 'cache-first' | 'cache-and-network' = 'cache-and-network'
) {
  const active = () => enabled() && Boolean(userId() && projectId());
  const readKey = () => JSON.stringify([userId(), projectId()]);
  const reads = lastKnownReadsFor(stringifyDocument(document));
  const authorization = createQueryAuthorization(readKey);
  const query = createLiveQuery(
    document,
    () => (active() ? { initiativeId: projectId() } : undefined),
    () => ({
      client: client(),
      requestPolicy,
      keepPreviousData: false,
      onResult: authorization.onResult,
      select: (data) => ({ viewerId: data.user.id, value: select(data) }),
    })
  );
  registerProjectRevalidation(client, active, () =>
    query.refetch({ requestPolicy: 'cache-and-network' })
  );
  const current = createMemo(() => {
    const result = query.data;
    return result && result.viewerId === userId() ? result : undefined;
  });
  createComputed(
    on(current, (result) => {
      if (result) reads.set(readKey(), result);
    })
  );
  const remembered = () => {
    const read = reads.get(readKey()) as AuthorizedRead<Result> | undefined;
    return read?.viewerId === userId() ? read : undefined;
  };
  const data = createMemo(() => {
    if (!active() || authorization.error()) return undefined;
    return (current() ?? remembered())?.value;
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
        ((query.isSuccess && current() !== undefined) ||
          remembered() !== undefined)
      );
    },
    get isPending() {
      return !active() || (query.isPending && remembered() === undefined);
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
    enabled,
    'cache-first'
  );
}

/** Authorizes native project previews without exposing backing document identity. */
export function useProjectIdentityQuery(
  id: Accessor<string>,
  userId: Accessor<string | undefined>
) {
  return createProjectIdentityQuery(getGraphqlSoupClient, userId, id);
}
