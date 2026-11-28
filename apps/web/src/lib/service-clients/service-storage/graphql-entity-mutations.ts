import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import { committedWithMissingRows } from '@graphql-cache/exchange/effect-errors';
import { networkRevalidated } from '@graphql-cache/exchange/network-revalidation-exchange';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import {
  optimisticMutationDispositionOf,
  type QueryRevalidation,
} from '@graphql-cache/exchange/optimistic';
import type { CacheHost } from '@graphql-cache/host/types';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { AnyVariables, OperationContext } from '@urql/core';
import type { GraphQLError } from 'graphql';
import { createEffect, createRoot, onCleanup } from 'solid-js';
import {
  DeleteEntitiesPermanentlyDocument,
  DuplicateEntitiesDocument,
  type DuplicateEntityInput,
  type EntityMutationPayloadFieldsFragment,
  type EntityRefInput,
  MoveEntitiesDocument,
  type MoveEntityInput,
  ReadEntityAppearanceDocument,
  RestoreEntitiesDocument,
  SetEntityAppearanceDocument,
  type SetEntityAppearanceInput,
  TrashEntitiesDocument,
  UpdateEntitySharePoliciesDocument,
  type UpdateEntitySharePolicyInput,
} from './graphql/generated/graphql';
import { getEntityGraphqlClient, getGraphqlCacheHost } from './graphql-soup';

/** An error resolving rows after a committed single or batch write. */
const isEffectsError = (error: GraphQLError) =>
  (error.path?.[1] === 'results' && error.path[3] === 'effects') ||
  (error.path?.[0] === 'setEntityAppearance' && error.path[1] === 'effects');

/** Predicted writes can resolve once durably queued. A result whose
 * effects failed to resolve, or whose rows or deletions the cache failed to
 * apply, says so (`effectsResolved: false`): the write committed, but its rows
 * never reached the cache. `queued` says the cache queued the write with its
 * revalidations, which it reads once the write commits. `listsReadAgain` says the
 * client's exchange read every mounted list again, each successfully, before
 * the write settled (no live cache).
 * Never retry a failed/ambiguous GraphQL write through the REST transport. */
function mutateEntity<Data, Variables extends AnyVariables>(
  operation: string,
  entity: EntityRefInput,
  document: TypedDocumentNode<Data, Variables>,
  variables: Variables,
  payload: (data: Data) => EntityMutationPayloadFieldsFragment,
  context: Partial<OperationContext> = {}
) {
  return traceEntityMutation(operation, entity, (span) =>
    sendEntityMutation(span, operation, document, variables, payload, context)
  );
}

function traceEntityMutation<T>(
  operation: string,
  entity: EntityRefInput,
  send: (span: Span) => Promise<T>
) {
  return Telemetry.span(`entity.${operation}`, async (span) => {
    span.setAttr('entity.id', entity.id);
    span.setAttr('entity.type', entity.type);
    try {
      return await send(span);
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
  // An HTTP 5xx is a failed write even when its only errors are effects.
  if (
    result.error &&
    (effectErrors.length < graphQLErrors.length ||
      !committedWithMissingRows(result))
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
    // The server returns the rows it could render and reports the others; the
    // caller keeps the returned rows and reads its lists again for the rest.
    span.setAttr('entity.effects_error', effectErrors[0]?.message ?? '');
    return {
      ...outcome,
      effectsResolved: false,
      queued: false,
      listsReadAgain: networkRevalidated(result),
    };
  }
  const metadata = normalizedCacheResultMetadata(result);
  const cacheRejected =
    metadata?.source === 'live-network' &&
    metadata.cacheEffectsApplied === false;
  if (cacheRejected) span.setAttr('entity.cache_effects_applied', false);
  return {
    ...outcome,
    effectsResolved: !cacheRejected,
    queued: optimisticMutationDispositionOf(result)?.kind === 'queued',
    listsReadAgain: networkRevalidated(result),
  };
}

export type AppearanceSettlement =
  | 'committed'
  | 'permanently-failed'
  | undefined;

function observeAppearanceSettlement(host: CacheHost, uuid: string) {
  let resolve!: (status: AppearanceSettlement) => void;
  const promise = new Promise<AppearanceSettlement>((finish) => {
    resolve = finish;
  });
  const stop = createRoot((dispose) => {
    function finish(status: AppearanceSettlement) {
      dispose();
      resolve(status);
    }
    onCleanup(
      host.onMutationSettled((result) => {
        if (result.mutationUuid === uuid)
          finish(result.status === 'superseded' ? undefined : result.status);
      })
    );
    onCleanup(
      host.onCacheGenerationChanged((change) => {
        if (change.queue === 'reset') finish(undefined);
      })
    );
    // A paused host still owns its queue. Only replacement or retirement
    // drops the listeners without settling the pending write.
    createEffect(() => {
      const current = getGraphqlCacheHost();
      if (current ? current !== host : !host.paused) finish(undefined);
    });
    return () => finish(undefined);
  });
  return { promise, stop };
}

export const setGraphqlEntityAppearance = (
  input: SetEntityAppearanceInput,
  revalidations: readonly QueryRevalidation[],
  isCurrent: () => boolean
) =>
  traceEntityMutation('set_appearance', input.entity, async (span) => {
    const client = getEntityGraphqlClient();
    const host = getGraphqlCacheHost();
    const uuid = host && crypto.randomUUID();
    // Subscribe before submission so a fast replay cannot outrun the listener.
    const observed =
      host && uuid ? observeAppearanceSettlement(host, uuid) : undefined;
    let queued = false;
    try {
      const result = await client
        .mutation(
          SetEntityAppearanceDocument,
          { input },
          {
            optimisticMutation: { revalidations, uuid },
            [TRACE_PARENT_CONTEXT_KEY]: span,
          }
        )
        .toPromise();
      const disposition = optimisticMutationDispositionOf(result);
      queued = disposition?.kind === 'queued';
      if (queued)
        return { queued, listsReadAgain: false, settlement: observed?.promise };
      if (disposition?.kind === 'permanently-failed') throw disposition.error;
      const errors = result.error?.graphQLErrors ?? [];
      if (
        result.error &&
        (result.error.networkError ||
          (result.error.response?.status ?? 0) >= 500 ||
          errors.length === 0 ||
          !errors.every(isEffectsError))
      )
        throw result.error;
      const effects = result.data?.setEntityAppearance?.effects;
      if (!effects)
        throw (
          result.error ?? new Error('Appearance mutation returned no result')
        );
      const { type, id } = input.entity;
      const listsReadAgain = networkRevalidated(result);
      // The queue and uncached exchange already recover mounted lists.
      if (
        effects.length === 0 &&
        disposition?.kind !== 'committed' &&
        !listsReadAgain &&
        isCurrent() &&
        (type === 'DOCUMENT' || type === 'INITIATIVE')
      ) {
        const rereadAppearance = async () => {
          const { error } = await client
            .query(
              ReadEntityAppearanceDocument,
              { input: { entityType: type, entityId: id } },
              {
                requestPolicy: 'network-only',
                [TRACE_PARENT_CONTEXT_KEY]: span,
              }
            )
            .toPromise();
          if (error) throw error;
        };
        fireAndForget(rereadAppearance(), 'appearance row recovery');
      }
      return { queued, listsReadAgain };
    } finally {
      if (!queued) observed?.stop();
    }
  });

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
