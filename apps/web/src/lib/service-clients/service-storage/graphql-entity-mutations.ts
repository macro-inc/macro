import { ThrownResultError } from '@core/util/result';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { Telemetry } from '@macro-inc/observability';
import type { AnyVariables } from '@urql/core';
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

/** These operations require an authoritative result, not a queued prediction.
 * Never retry a failed/ambiguous GraphQL write through the REST transport. */
async function mutateEntity<Data, Variables extends AnyVariables>(
  operation: string,
  entity: EntityRefInput,
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
  payload: (data: Data) => EntityMutationPayloadFieldsFragment
) {
  return Telemetry.span(`entity.${operation}`, async (span) => {
    span.setAttr('entity.id', entity.id);
    span.setAttr('entity.type', entity.type);
    const result = await getEntityGraphqlClient()
      .mutation(document, variables)
      .toPromise();
    if (result.error) throw result.error;
    const results = result.data ? payload(result.data).results : [];
    const outcome = results[0];
    if (results.length !== 1 || !outcome)
      throw new Error(`${operation} returned no unambiguous entity result`);
    if (outcome.__typename === 'GraphqlMutationError') {
      throw new ThrownResultError([
        { code: outcome.errorCode, message: outcome.message },
      ]);
    }
    return outcome;
  });
}

export const moveGraphqlEntity = (input: MoveEntityInput) =>
  mutateEntity(
    'move',
    input.entity,
    MoveEntitiesDocument,
    { inputs: [input] },
    (data) => data.moveEntities
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
