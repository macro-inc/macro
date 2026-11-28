import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { ThrownResultError } from '@core/util/result';
import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { AnyVariables, OperationContext } from '@urql/core';
import type { GraphQLError } from 'graphql';
import {
  DeleteEntitiesPermanentlyDocument,
  DuplicateEntitiesDocument,
  type DuplicateEntityInput,
  type EntityMutationPayloadFieldsFragment,
  type EntityRefInput,
  MoveEntitiesDocument,
  type MoveEntityInput,
  RestoreEntitiesDocument,
  TrashEntitiesDocument,
  UpdateEntitySharePoliciesDocument,
  type UpdateEntitySharePolicyInput,
} from './graphql/generated/graphql';
import { getEntityGraphqlClient } from './graphql-soup';

/** An error resolving `<mutation>.results[n].effects`. */
const isEffectsError = (error: GraphQLError) =>
  error.path?.[1] === 'results' && error.path[3] === 'effects';

/** Moves resolve with their cache prediction once durably queued; the other
 * operations have no resolver and wait for the server's result. A result whose
 * effects failed to resolve says so (`effectsResolved: false`): the write
 * committed, but its rows never reached the cache.
 * Never retry a failed/ambiguous GraphQL write through the REST transport. */
async function mutateEntity<Data, Variables extends AnyVariables>(
  operation: string,
  entity: EntityRefInput,
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
  payload: (data: Data) => EntityMutationPayloadFieldsFragment,
  context: Partial<OperationContext> = {}
) {
  return Telemetry.span(`entity.${operation}`, async (span) => {
    span.setAttr('entity.id', entity.id);
    span.setAttr('entity.type', entity.type);
    try {
      return await sendEntityMutation(
        span,
        operation,
        document,
        variables,
        payload,
        context
      );
    } catch (error) {
      // A fixed message: server errors can echo entity names.
      span.error(`Entity ${operation} failed`);
      throw error;
    }
  });
}

async function sendEntityMutation<Data, Variables extends AnyVariables>(
  span: Span,
  operation: string,
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
  payload: (data: Data) => EntityMutationPayloadFieldsFragment,
  context: Partial<OperationContext>
) {
  // Its request, queue attempt and cache writes join this span's trace.
  const result = await getEntityGraphqlClient()
    .mutation(document, variables, {
      ...context,
      [TRACE_PARENT_CONTEXT_KEY]: span,
    })
    .toPromise();
  // A result's effects are its cache patches, resolved after the write
  // committed: failing to render them does not undo the mutation.
  const graphQLErrors = result.error?.graphQLErrors ?? [];
  const effectErrors = graphQLErrors.filter(isEffectsError);
  if (
    result.error &&
    (result.error.networkError || effectErrors.length < graphQLErrors.length)
  )
    throw result.error;
  const results = result.data ? payload(result.data).results : [];
  const outcome = results[0];
  if (results.length !== 1 || !outcome)
    throw new Error(`${operation} returned no unambiguous entity result`);
  if (outcome.__typename === 'GraphqlMutationError') {
    span.setAttr('entity.error_code', outcome.errorCode);
    throw new ThrownResultError([
      { code: outcome.errorCode, message: outcome.message },
    ]);
  }
  if (effectErrors.length > 0) {
    // The caller reads its lists again for what the patches would carry.
    span.setAttr('entity.effects_error', effectErrors[0]?.message ?? '');
    return { ...outcome, effects: [], effectsResolved: false };
  }
  return { ...outcome, effectsResolved: true };
}

/** A move the cache predicts is queued, so the lists it cannot keep current are
 * named here and read again once the move commits, including on replay. */
export const moveGraphqlEntity = (
  input: MoveEntityInput,
  revalidations: readonly QueryRevalidation[]
) =>
  mutateEntity(
    'move',
    input.entity,
    MoveEntitiesDocument,
    { inputs: [input] },
    (data) => data.moveEntities,
    { optimisticMutation: { revalidations } }
  );

export const trashGraphqlEntity = (entity: EntityRefInput) =>
  mutateEntity(
    'trash',
    entity,
    TrashEntitiesDocument,
    { entities: [entity] },
    (data) => data.trashEntities
  );

export const restoreGraphqlEntity = (entity: EntityRefInput) =>
  mutateEntity(
    'restore',
    entity,
    RestoreEntitiesDocument,
    { entities: [entity] },
    (data) => data.restoreEntities
  );

export const permanentlyDeleteGraphqlEntity = (entity: EntityRefInput) =>
  mutateEntity(
    'delete_permanently',
    entity,
    DeleteEntitiesPermanentlyDocument,
    { entities: [entity] },
    (data) => data.deleteEntitiesPermanently
  );

export const duplicateGraphqlEntity = (input: DuplicateEntityInput) =>
  mutateEntity(
    'duplicate',
    input.entity,
    DuplicateEntitiesDocument,
    { inputs: [input] },
    (data) => data.duplicateEntities
  );

export const updateGraphqlEntitySharePolicy = (
  input: UpdateEntitySharePolicyInput
) =>
  mutateEntity(
    'update_share_policy',
    input.entity,
    UpdateEntitySharePoliciesDocument,
    { inputs: [input] },
    (data) => data.updateEntitySharePolicies
  );
