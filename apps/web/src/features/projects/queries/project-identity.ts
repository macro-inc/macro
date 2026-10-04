import type { OptimisticResponse } from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { createQueryAuthorization } from '@queries/authorization';
import { queryClient } from '@queries/client';
import {
  InitiativeDocument,
  type InitiativeQuery,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { mapInitiativeDetail } from '@service-storage/initiative';
import {
  type QueryClient,
  useIsMutating,
  useMutationState,
} from '@tanstack/solid-query';
import { type Client, stringifyDocument } from '@urql/core';
import { type Accessor, createMemo } from 'solid-js';
import type {
  ProjectTaskMutationContext,
  ProjectTaskMutationVariables,
} from './create-project-task';
import { projectKeys } from './keys';
import { toProjectDetail } from './project-model';
import { projectProperties } from './project-properties';
import { registerProjectRevalidation } from './project-revalidation';

type InitiativeDetail = ReturnType<typeof mapInitiativeDetail>;

export const projectDetailData = (project: InitiativeDetail) => ({
  project: toProjectDetail(project),
  properties: projectProperties(project.properties),
});

/** Seeds the detail read from a create response, so opening it needs no request. */
export async function seedProjectDetail(
  cache: QueryClient,
  userId: string | undefined,
  project: InitiativeDetail,
  host?: Pick<CacheHost, 'writeQuery' | 'disabled'>
) {
  cache.setQueryData(
    projectKeys.detail(userId, project.id).queryKey,
    projectDetailData(project)
  );
  if (!host || host.disabled || !userId) return;
  try {
    // The create response already normalized the complete record. Establish its
    // query edge without copying a second snapshot over those live fields.
    await host.writeQuery({
      query: stringifyDocument(InitiativeDocument),
      operationName: 'Initiative',
      variables: { initiativeId: project.id },
      data: {
        user: {
          id: userId,
          initiative: { __typename: 'GraphqlSoupInitiative', id: project.id },
        },
      } satisfies OptimisticResponse<InitiativeQuery>,
    });
  } catch (error) {
    console.warn(
      'Created project could not be seeded in the local cache',
      error
    );
  }
}

/** One authorized read backs the project view and its chips and previews. */
export function createProjectDetailQuery(
  client: () => Client,
  cache: QueryClient,
  userId: Accessor<string | undefined>,
  projectId: Accessor<string>,
  enabled: Accessor<boolean> = () => true
) {
  const creating = useIsMutating(
    () => ({ mutationKey: projectKeys.createTask._def }),
    () => cache
  );
  const pendingTasks = useMutationState(
    () => ({
      filters: {
        mutationKey: projectKeys.createTask._def,
        status: 'pending' as const,
      },
      select: (mutation) => ({
        variables: mutation.state.variables as
          | ProjectTaskMutationVariables
          | undefined,
        context: mutation.state.context as
          | ProjectTaskMutationContext
          | undefined,
      }),
    }),
    () => cache
  );
  const active = () => enabled() && Boolean(userId() && projectId());
  const authorization = createQueryAuthorization(() =>
    JSON.stringify([userId(), projectId()])
  );
  const query = createLiveQuery(
    InitiativeDocument,
    () => (active() ? { initiativeId: projectId() } : undefined),
    () => ({
      client: client(),
      // REST task creation seeds membership before publishing temporary IDs.
      // Keep listening locally while preventing a refresh from erasing them.
      requestPolicy: creating() ? 'cache-only' : 'cache-and-network',
      keepPreviousData: false,
      onResult: authorization.onResult,
      select: (data) => ({
        viewerId: data.user.id,
        detail: projectDetailData(mapInitiativeDetail(data.user.initiative)),
      }),
    })
  );
  registerProjectRevalidation(
    client,
    () => active() && !creating(),
    () => query.refetch({ requestPolicy: 'cache-and-network' })
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
    const detail = result.detail;
    const pending = pendingTasks().flatMap(({ variables, context }) =>
      context &&
      variables &&
      variables.ownerId === userId() &&
      variables.projectId === projectId() &&
      variables.scope?.isCurrent()
        ? [{ temporaryId: variables.id, id: context.membershipId() }]
        : []
    );
    if (!pending.length) return detail;
    const temporaryIds = new Set(pending.map(({ temporaryId }) => temporaryId));
    // REST creates own their membership until settlement. Full GraphQL entity
    // responses (e.g. a rename) must not hide a task still being saved.
    const taskIds = [
      ...new Set([
        ...detail.project.taskIds.filter((id) => !temporaryIds.has(id)),
        ...pending.flatMap(({ id }) => (id ? [id] : [])),
      ]),
    ];
    return { ...detail, project: { ...detail.project, taskIds } };
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

/** Authorizes native project previews without exposing backing document identity. */
export function useProjectIdentityQuery(
  id: Accessor<string>,
  userId: Accessor<string | undefined>
) {
  const query = createProjectDetailQuery(
    getGraphqlSoupClient,
    queryClient,
    userId,
    id
  );
  return {
    get isSuccess() {
      return query.isSuccess;
    },
    get isError() {
      return query.isError;
    },
    get isPending() {
      return query.isPending;
    },
    get error() {
      return query.error;
    },
    get data() {
      return query.data?.project;
    },
  };
}
