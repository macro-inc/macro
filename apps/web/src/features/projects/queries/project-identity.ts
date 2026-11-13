import { usePendingEntityAppearance } from '@app/features/entity-appearance/queries/pending-appearance';
import { fireAndForget } from '@core/util/fireAndForget';
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
import {
  type Client,
  createRequest,
  type DocumentInput,
  getOperationName,
  type RequestPolicy,
  stringifyDocument,
} from '@urql/core';
import { type Accessor, createEffect, createMemo, untrack } from 'solid-js';
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
  select: (data: QueryData, failedRead: boolean) => Result,
  client: () => Client,
  userId: Accessor<string | undefined>,
  projectId: Accessor<string>,
  enabled: Accessor<boolean>,
  requestPolicy: RequestPolicy = 'cache-and-network'
) {
  const operationName = getOperationName(
    createRequest(document, { initiativeId: '' }).query
  );
  const currentClient = createMemo(client);
  const currentViewer = createMemo(userId);
  const currentProject = createMemo(projectId);
  const readEnabled = createMemo(enabled);
  const scope = createMemo(() => ({
    client: currentClient(),
    viewerId: currentViewer(),
    projectId: currentProject(),
    active: readEnabled() && Boolean(currentViewer() && currentProject()),
  }));
  const active = () => scope().active;
  const authorization = createMemo(() => {
    const current = scope();
    const key = JSON.stringify([
      operationName,
      current.viewerId,
      current.projectId,
    ]);
    return createQueryAuthorization(() => key, current.client);
  });
  const query = createLiveQuery(
    document,
    () => (active() ? { initiativeId: scope().projectId } : undefined),
    () => {
      const current = scope();
      const auth = authorization();
      return {
        client: current.client,
        requestPolicy: untrack(() =>
          auth.error() ? 'network-only' : requestPolicy
        ),
        context: auth.requestContext(),
        keepPreviousData: false,
        onResult: (result) => {
          if (result.data && result.data.user.id !== current.viewerId) return;
          auth.onResult(result);
        },
        select: (data) => ({ viewerId: data.user.id, value: data }),
      };
    }
  );
  const refetch: typeof query.refetch = (options = {}) =>
    query.refetch({
      ...options,
      context: { ...options.context, ...authorization().requestContext() },
    });
  registerProjectRevalidation(client, active, () =>
    refetch({ requestPolicy: 'cache-and-network' })
  );
  let recoveredScope: ReturnType<typeof scope> | undefined;
  createEffect(() => {
    const current = scope();
    const result = query.data;
    if (
      !current.active ||
      !result ||
      result.viewerId === current.viewerId ||
      recoveredScope === current
    )
      return;
    recoveredScope = current;
    fireAndForget(
      refetch({ requestPolicy: 'network-only' }),
      'project-identity.viewer-recovery'
    );
  });
  const data = createMemo(() => {
    const result = query.data;
    if (
      !active() ||
      authorization().error() ||
      !result ||
      result.viewerId !== userId()
    )
      return undefined;
    return select(result.value, Boolean(query.error));
  });
  return {
    get data() {
      return data();
    },
    get error() {
      return active() ? (authorization().error() ?? query.error) : null;
    },
    get isSuccess() {
      return (
        active() &&
        !authorization().error() &&
        query.isSuccess &&
        query.data?.viewerId === userId()
      );
    },
    get isPending() {
      return (
        !active() ||
        query.isPending ||
        (query.isFetching && query.data?.viewerId !== scope().viewerId)
      );
    },
    get isError() {
      return active() && Boolean(authorization().error() || query.isError);
    },
    refetch,
  };
}

/** The project view's read: counts, task ids, members, sharing, and properties. */
export function createProjectDetailQuery(
  client: () => Client,
  userId: Accessor<string | undefined>,
  projectId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  const pendingAppearance = usePendingEntityAppearance();
  return createAuthorizedProjectQuery(
    InitiativeDocument,
    (data, failedRead) => {
      const result = projectDetailData(
        mapInitiativeDetail(data.user.initiative)
      );
      const appearance = pendingAppearance(
        'initiative',
        result.project.id,
        failedRead
      );
      return appearance
        ? { ...result, project: { ...result.project, appearance } }
        : result;
    },
    client,
    userId,
    projectId,
    enabled
  );
}

/** Chips, previews, and labels read only identity and viewer access. */
export function createProjectIdentityQuery(
  client: () => Client,
  userId: Accessor<string | undefined>,
  projectId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  const pendingAppearance = usePendingEntityAppearance();
  return createAuthorizedProjectQuery(
    InitiativeIdentityDocument,
    (data, failedRead): ProjectIdentity => {
      const project = mapInitiativeIdentity(data.user.initiative);
      return {
        id: project.id,
        name: project.name,
        ownerId: project.ownerId,
        appearance:
          pendingAppearance('initiative', project.id, failedRead) ??
          project.appearance,
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
