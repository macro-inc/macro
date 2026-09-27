import { catchToResult, ThrownResultError } from '@core/util/result';
import type {
  AnyVariables,
  Client,
  DocumentInput,
  OperationResult,
} from '@urql/core';
import {
  AssignInitiativeTasksDocument,
  ClearTaskInitiativeDocument,
  CreateInitiativeDocument,
  type CreateInitiativeInput,
  DeleteInitiativeDocument,
  type GraphqlEntityAccessLevel,
  type InitiativeDetailFieldsFragment,
  InitiativeDocument,
  type InitiativeLinkShare,
  type InitiativePageInput,
  type InitiativeSummaryFieldsFragment,
  InitiativesDocument,
  InitiativeTasksDocument,
  TaskInitiativeReferencesDocument,
  UpdateInitiativeDocument,
  type UpdateInitiativeInput,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient, mapGraphqlProperties } from './graphql-soup';

/** Filters are applied by the initiative service before cursor pagination. */
export type InitiativePageParams = Omit<InitiativePageInput, 'sort'> & {
  sort?: 'updated' | 'name' | 'due';
};

type InitiativeAccess = Lowercase<GraphqlEntityAccessLevel>;
export type InitiativeSharingPatch = {
  linkShare?: InitiativeLinkShare | null;
  linkShareAccessLevel?: InitiativeAccess | null;
  teamShareAccessLevel?: InitiativeAccess | null;
  channelSharePermissions?:
    | {
        channelId: string;
        operation: 'add' | 'remove' | 'replace';
        accessLevel?: InitiativeAccess | null;
      }[]
    | null;
};
export type InitiativeUpdate = Omit<
  UpdateInitiativeInput,
  'sharePermission'
> & {
  sharePermission?: InitiativeSharingPatch | null;
};

const ACCESS_FROM_GRAPHQL = {
  VIEW: 'view',
  COMMENT: 'comment',
  EDIT: 'edit',
  OWNER: 'owner',
} as const;
const ACCESS_TO_GRAPHQL = {
  view: 'VIEW',
  comment: 'COMMENT',
  edit: 'EDIT',
  owner: 'OWNER',
} as const;
const SORT_TO_GRAPHQL = {
  updated: 'UPDATED',
  name: 'NAME',
  due: 'DUE',
} as const;
const ASSIGNMENT_FROM_GRAPHQL = {
  ASSIGNED: 'assigned',
  MOVED: 'moved',
  NOT_A_TASK: 'notATask',
  NOT_FOUND: 'notFound',
  SKIPPED_NO_PERMISSION: 'skippedNoPermission',
} as const;
const OPERATION_TO_GRAPHQL = {
  add: 'ADD',
  remove: 'REMOVE',
  replace: 'REPLACE',
} as const;
const REFERENCE_FROM_GRAPHQL = {
  NONE: 'none',
  UNAVAILABLE: 'unavailable',
  VISIBLE: 'visible',
} as const;

export function mapInitiativeSummary(project: InitiativeSummaryFieldsFragment) {
  return {
    id: project.id,
    name: project.name,
    descriptionDocumentId: project.descriptionDocumentId,
    updatedAt: project.updatedAt,
    userAccessLevel: ACCESS_FROM_GRAPHQL[project.userAccessLevel],
    taskCount: project.taskCount,
    completedTaskCount: project.completedTaskCount,
    properties: mapGraphqlProperties(project.properties),
  };
}

export function mapInitiativeDetail(project: InitiativeDetailFieldsFragment) {
  const sharing = project.sharePermission;
  return {
    ...mapInitiativeSummary(project),
    ownerId: project.ownerId,
    memberIds: project.memberIds,
    taskIds: project.taskIds,
    createdAt: project.createdAt,
    sharePermission: {
      id: sharing.id,
      owner: sharing.owner,
      linkShare: sharing.linkShare,
      linkShareAccessLevel: sharing.linkShareAccessLevel
        ? ACCESS_FROM_GRAPHQL[sharing.linkShareAccessLevel]
        : null,
      teamShareAccessLevel: sharing.teamShareAccessLevel
        ? ACCESS_FROM_GRAPHQL[sharing.teamShareAccessLevel]
        : null,
      channelSharePermissions: sharing.channelSharePermissions?.map(
        (grant) => ({
          channel_id: grant.channelId,
          access_level: ACCESS_FROM_GRAPHQL[grant.accessLevel],
        })
      ),
    },
  };
}

export function initiativeUpdateInput(
  input: InitiativeUpdate
): UpdateInitiativeInput {
  const sharing = input.sharePermission;
  return {
    name: input.name,
    memberIds: input.memberIds,
    sharePermission: sharing
      ? {
          linkShare: sharing.linkShare,
          linkShareAccessLevel: sharing.linkShareAccessLevel
            ? ACCESS_TO_GRAPHQL[sharing.linkShareAccessLevel]
            : sharing.linkShareAccessLevel,
          teamShareAccessLevel: sharing.teamShareAccessLevel
            ? ACCESS_TO_GRAPHQL[sharing.teamShareAccessLevel]
            : sharing.teamShareAccessLevel,
          channelSharePermissions: sharing.channelSharePermissions?.map(
            (grant) => ({
              channelId: grant.channelId,
              operation: OPERATION_TO_GRAPHQL[grant.operation],
              accessLevel: grant.accessLevel
                ? ACCESS_TO_GRAPHQL[grant.accessLevel]
                : grant.accessLevel,
            })
          ),
        }
      : sharing,
  };
}

function operationData<Data, Variables extends AnyVariables>(
  result: OperationResult<Data, Variables>
): Data {
  if (result.error) {
    if (result.error.graphQLErrors.length) {
      throw new ThrownResultError(
        result.error.graphQLErrors.map((error) => ({
          code:
            typeof error.extensions.code === 'string'
              ? error.extensions.code
              : 'UNKNOWN',
          message: error.message,
        }))
      );
    }
    throw result.error;
  }
  if (!result.data) throw new Error('Initiative request returned no data');
  return result.data;
}

/** All project operations use the authenticated, normalized GraphQL client. */
export function createInitiativeClient(client: () => Client) {
  async function query<Data, Variables extends AnyVariables>(
    document: DocumentInput<Data, Variables>,
    variables: Variables,
    signal?: AbortSignal
  ) {
    signal?.throwIfAborted();
    const result = await client()
      .query(document, variables, {
        requestPolicy: 'network-only',
        ...(signal ? { fetchOptions: { signal } } : {}),
      })
      .toPromise();
    signal?.throwIfAborted();
    return operationData(result);
  }
  async function mutation<Data, Variables extends AnyVariables>(
    document: DocumentInput<Data, Variables>,
    variables: Variables
  ) {
    return operationData(
      await client().mutation(document, variables).toPromise()
    );
  }
  return {
    page: (params: InitiativePageParams, signal?: AbortSignal) =>
      catchToResult(async () => {
        const data = await query(
          InitiativesDocument,
          {
            input: {
              ...params,
              sort: params.sort ? SORT_TO_GRAPHQL[params.sort] : undefined,
            },
          },
          signal
        );
        return {
          initiatives:
            data.user.initiatives.initiatives.map(mapInitiativeSummary),
          nextCursor: data.user.initiatives.nextCursor,
        };
      }),
    get: (id: string, signal?: AbortSignal) =>
      catchToResult(async () =>
        mapInitiativeDetail(
          (await query(InitiativeDocument, { initiativeId: id }, signal)).user
            .initiative
        )
      ),
    tasks: (
      id: string,
      params: { cursor?: string; limit?: number },
      signal?: AbortSignal
    ) =>
      catchToResult(
        async () =>
          (
            await query(
              InitiativeTasksDocument,
              { initiativeId: id, input: params },
              signal
            )
          ).user.initiativeTasks
      ),
    taskReferences: (taskIds: string[], signal?: AbortSignal) =>
      catchToResult(async () => ({
        references: (
          await query(TaskInitiativeReferencesDocument, { taskIds }, signal)
        ).user.taskInitiativeReferences.map((reference) => ({
          taskId: reference.taskId,
          state: REFERENCE_FROM_GRAPHQL[reference.state],
          initiative: reference.initiative,
        })),
      })),
    create: (input: CreateInitiativeInput) =>
      catchToResult(async () =>
        mapInitiativeDetail(
          (await mutation(CreateInitiativeDocument, { input })).createInitiative
        )
      ),
    update: (id: string, input: InitiativeUpdate) =>
      catchToResult(async () =>
        mapInitiativeDetail(
          (
            await mutation(UpdateInitiativeDocument, {
              initiativeId: id,
              input: initiativeUpdateInput(input),
            })
          ).updateInitiative
        )
      ),
    delete: (id: string) =>
      catchToResult(
        async () =>
          (await mutation(DeleteInitiativeDocument, { initiativeId: id }))
            .deleteInitiative
      ),
    assignTasks: (id: string, input: { taskIds: string[] }) =>
      catchToResult(async () => ({
        results: (
          await mutation(AssignInitiativeTasksDocument, {
            initiativeId: id,
            taskIds: input.taskIds,
          })
        ).assignInitiativeTasks.map((result) => ({
          taskId: result.taskId,
          status: ASSIGNMENT_FROM_GRAPHQL[result.status],
        })),
      })),
    removeTask: (taskId: string) =>
      catchToResult(
        async () =>
          (await mutation(ClearTaskInitiativeDocument, { taskId }))
            .clearTaskInitiative
      ),
  };
}

export const initiativeClient = createInitiativeClient(getGraphqlSoupClient);
