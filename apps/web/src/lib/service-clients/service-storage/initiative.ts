import { catchToResult, ThrownResultError } from '@core/util/result';
import type {
  AnyVariables,
  Client,
  DocumentInput,
  OperationResult,
} from '@urql/core';
import {
  CreateInitiativeDocument,
  type CreateInitiativeInput,
  DeleteInitiativeDocument,
  EnsureInitiativeDescriptionSurfaceDocument,
  type GraphqlEntityAccessLevel,
  type InitiativeDetailFieldsFragment,
  InitiativeDocument,
  type InitiativeLinkShare,
  UpdateInitiativeDocument,
  type UpdateInitiativeInput,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient, mapGraphqlProperties } from './graphql-soup';

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
const OPERATION_TO_GRAPHQL = {
  add: 'ADD',
  remove: 'REMOVE',
  replace: 'REPLACE',
} as const;

export function mapInitiativeDetail(project: InitiativeDetailFieldsFragment) {
  const sharing = project.sharePermission;
  const permission = project.viewerPermission;
  return {
    id: project.id,
    name: project.displayName ?? 'Untitled project',
    updatedAt: project.metadata.updatedAt ?? '',
    userAccessLevel:
      permission?.__typename === 'GraphqlAccessLevelPermission'
        ? ACCESS_FROM_GRAPHQL[permission.accessLevel]
        : ('view' as const),
    taskCount: project.taskCount,
    completedTaskCount: project.completedTaskCount,
    properties: mapGraphqlProperties(project.properties),
    ownerId: project.metadata.ownerId ?? '',
    memberIds: project.memberIds,
    taskIds: project.taskIds,
    createdAt: project.metadata.createdAt ?? '',
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
    get: (id: string, signal?: AbortSignal) =>
      catchToResult(async () =>
        mapInitiativeDetail(
          (await query(InitiativeDocument, { initiativeId: id }, signal)).user
            .initiative
        )
      ),
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
    /** Ensure the description surface, which has the project's id, before connecting. */
    ensureDescriptionSurface: (id: string) =>
      catchToResult(
        async () =>
          (
            await mutation(EnsureInitiativeDescriptionSurfaceDocument, {
              initiativeId: id,
            })
          ).ensureInitiativeDescriptionSurface
      ),
    delete: (id: string) =>
      catchToResult(
        async () =>
          (await mutation(DeleteInitiativeDocument, { initiativeId: id }))
            .deleteInitiative
      ),
  };
}

export const initiativeClient = createInitiativeClient(getGraphqlSoupClient);
