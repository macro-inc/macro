import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { ThrownResultError } from '@core/util/result';
import { networkRevalidated } from '@graphql-cache/exchange/network-revalidation-exchange';
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
 * committed, but its rows never reached the cache. `listsReadAgain` says the
 * client's exchange read every mounted list again, each successfully, before
 * the write settled (no live cache).
 * Never retry a failed/ambiguous GraphQL write through the REST transport. */
async function mutateEntities<Data, Variables extends AnyVariables>(
  operation: string,
  entities: readonly EntityRefInput[],
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
  payload: (data: Data) => EntityMutationPayloadFieldsFragment,
  context: Partial<OperationContext> = {}
) {
  return Telemetry.span(`entity.${operation}`, async (span) => {
    span.setAttr('entity.count', entities.length);
    if (entities.length === 1) {
      span.setAttr('entity.id', entities[0].id);
      span.setAttr('entity.type', entities[0].type);
    }
    try {
      return await sendEntityMutations(
        span,
        operation,
        entities.length,
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

type EntityMutationOutcome =
  EntityMutationPayloadFieldsFragment['results'][number];

function requireEntityMutationSuccess(outcome: EntityMutationOutcome) {
  if (outcome.__typename === 'GraphqlMutationError') {
    throw new ThrownResultError([
      { code: outcome.errorCode, message: outcome.message },
    ]);
  }
  return outcome;
}

async function mutateEntity<Data, Variables extends AnyVariables>(
  operation: string,
  entity: EntityRefInput,
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
  payload: (data: Data) => EntityMutationPayloadFieldsFragment,
  context?: Partial<OperationContext>
) {
  const { results, effectsResolved, listsReadAgain } = await mutateEntities(
    operation,
    [entity],
    document,
    variables,
    payload,
    context
  );
  const outcome = requireEntityMutationSuccess(results[0]);
  return {
    ...outcome,
    effects: effectsResolved ? outcome.effects : [],
    effectsResolved,
    listsReadAgain,
  };
}

async function sendEntityMutations<Data, Variables extends AnyVariables>(
  span: Span,
  operation: string,
  count: number,
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
  if (results.length !== count || results.some((outcome) => !outcome))
    throw new Error(`${operation} returned no unambiguous entity result`);
  const failures = results.filter(
    (outcome) => outcome.__typename === 'GraphqlMutationError'
  );
  span.setAttr('entity.failed_count', failures.length);
  if (failures[0]) {
    span.setAttr('entity.error_code', failures[0].errorCode);
    span.error(`Entity ${operation} failed`);
  }
  if (effectErrors.length > 0) {
    // The caller reads its lists again for what the patches would carry.
    span.setAttr('entity.effects_error', effectErrors[0]?.message ?? '');
  }
  return {
    results,
    effectsResolved: effectErrors.length === 0,
    listsReadAgain: networkRevalidated(result),
  };
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

export const moveGraphqlEntities = (
  inputs: MoveEntityInput[],
  revalidations: readonly QueryRevalidation[]
) =>
  mutateEntities(
    'move',
    inputs.map(({ entity }) => entity),
    MoveEntitiesDocument,
    { inputs },
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

export const duplicateGraphqlEntities = (inputs: DuplicateEntityInput[]) =>
  mutateEntities(
    'duplicate',
    inputs.map(({ entity }) => entity),
    DuplicateEntitiesDocument,
    { inputs },
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
