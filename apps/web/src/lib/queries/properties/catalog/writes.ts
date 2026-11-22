/**
 * Property catalog writes: GraphQL mutations against the normalized cache.
 *
 * - Updating and deleting an option, and deleting a definition, are predicted
 *   by the resolvers in `resolvers.ts`: every reader shows the change at once,
 *   the cache rolls it back if the server refuses, and offline writes queue.
 * - Adding an option shows it at once under an id minted here, linked into the
 *   cached lists it belongs to. The server creates it under that id and a
 *   replay answers with it, so a queued add resolves at once with its final id
 *   and callers can apply it to an entity.
 * - Creating a definition, provisioning a tag set, and sharing or replacing a
 *   tag are answered by the server (it assigns ids and owners, and decides
 *   name collisions); the lists that hold them reload after it answers.
 */

import {
  executeOptimisticMutation,
  type OptimisticUpdate,
  optimisticMutationDispositionOf,
  prependUnique,
  select,
  update,
} from '@graphql-cache/index';
import { Telemetry } from '@macro-inc/observability';
import type { AddPropertyOptionRequest } from '@service-properties/generated/schemas/addPropertyOptionRequest';
import type { CreatePropertyDefinitionRequest } from '@service-properties/generated/schemas/createPropertyDefinitionRequest';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOptionResponse } from '@service-properties/generated/schemas/propertyOptionResponse';
import type { TagScope } from '@service-properties/generated/schemas/tagScope';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { UpdatePropertyOptionRequest } from '@service-properties/generated/schemas/updatePropertyOptionRequest';
import {
  AddPropertyOptionDocument,
  type AddPropertyOptionMutation,
  CreatePropertyDefinitionDocument,
  DeletePropertyDefinitionDocument,
  DeletePropertyOptionDocument,
  EnsureTagSetDocument,
  MergeTagDocument,
  PromoteTagDocument,
  PropertyCatalogDefinitionsWithOptionsDocument,
  PropertyCatalogOptionsDocument,
  PropertyCatalogTagSetsDocument,
  UpdatePropertyOptionDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { AnyVariables, OperationResult } from '@urql/core';
import { v4 as uuidv4 } from 'uuid';
import { queryClient } from '../../client';
import { observePropertyMutationSettlements } from '../graphql/mutation-settlements';
import { propertiesKeys } from '../keys';
import { CatalogMutationError, isCatalogErrorCode } from './errors';
import {
  optionValueRecord,
  toAddOptionInput,
  toCreateDefinitionInput,
  toGraphqlTagScope,
  toPropertyDefinition,
  toPropertyOption,
  toTagOption,
  toTagSet,
} from './map';
import {
  type CatalogReader,
  catalogReaders,
  refreshCatalogReaders,
  refreshCatalogReadersInBackground,
} from './readers';

export { CatalogMutationError, isCatalogErrorCode };

/** The code REST's status class carried, for a refusal made before GraphQL ran. */
function httpStatusCode(status: number | undefined): string | undefined {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  return undefined;
}

function errorOf(result: OperationResult): CatalogMutationError {
  const [first] = result.error?.graphQLErrors ?? [];
  const code = first?.extensions?.code;
  const response = result.error?.response as Response | undefined;
  return new CatalogMutationError(
    first?.message ?? result.error?.message ?? 'Property catalog write failed',
    typeof code === 'string' ? code : httpStatusCode(response?.status)
  );
}

type Settled<TData> =
  | { kind: 'committed'; data: TData | undefined }
  | { kind: 'queued' };

/**
 * Submits one write and reads its outcome. A queued write (offline, or behind
 * an older write) either waits for its commit, or resolves at once and reports
 * a later refusal through `onLateFailure`; the cache has rolled it back by then.
 */
async function settle<TData, TVariables extends AnyVariables>(
  send: () => Promise<OperationResult<TData, TVariables>>,
  options: { waitForCommit: boolean; onLateFailure?: (error: Error) => void }
): Promise<Settled<TData>> {
  const settlements = observePropertyMutationSettlements(
    getGraphqlSoupCacheHost()
  );
  let observing = false;
  try {
    const result = await send();
    const disposition = optimisticMutationDispositionOf(result);
    if (disposition?.kind === 'queued') {
      if (options.waitForCommit) {
        await settlements.waitForCommit(disposition.transactionId);
        return { kind: 'committed', data: undefined };
      }
      observing = true;
      settlements
        .waitForCommit(disposition.transactionId)
        .catch((error: unknown) => {
          const failure =
            error instanceof Error ? error : new Error(String(error));
          console.error('Queued property catalog write failed', failure);
          options.onLateFailure?.(failure);
        })
        .finally(() => settlements.dispose());
      return { kind: 'queued' };
    }
    if (result.error) throw errorOf(result);
    if (disposition?.kind === 'permanently-failed') {
      throw new CatalogMutationError(disposition.error.message);
    }
    return { kind: 'committed', data: result.data };
  } finally {
    if (!observing) settlements.dispose();
  }
}

function noData(operation: string): never {
  throw new CatalogMutationError(`${operation} returned no data`);
}

const usingCache = () => getGraphqlSoupCacheHost() !== undefined;

// ---------------------------------------------------------------------------
// Predicted by resolvers

export async function updatePropertyOption(
  propertyDefinitionId: string,
  optionId: string,
  body: UpdatePropertyOptionRequest,
  onLateFailure: (error: Error) => void
): Promise<void> {
  await Telemetry.span('property_catalog.update_option', async (span) => {
    span.setAttr('property.definition_id', propertyDefinitionId);
    span.setAttr('property.option_id', optionId);
    const outcome = await settle(
      () =>
        getGraphqlSoupClient()
          .mutation(UpdatePropertyOptionDocument, {
            input: {
              propertyDefinitionId,
              optionId,
              ...(body.value != null ? { value: body.value } : {}),
              ...(body.color != null ? { color: body.color } : {}),
              ...(body.display_order != null
                ? { displayOrder: body.display_order }
                : {}),
            },
          })
          .toPromise(),
      { waitForCommit: false, onLateFailure }
    );
    span.setAttr('property.outcome', outcome.kind);
  });
}

export async function deletePropertyOption(
  propertyDefinitionId: string,
  optionId: string,
  onLateFailure: (error: Error) => void
): Promise<void> {
  await Telemetry.span('property_catalog.delete_option', async (span) => {
    span.setAttr('property.definition_id', propertyDefinitionId);
    span.setAttr('property.option_id', optionId);
    const outcome = await settle(
      () =>
        getGraphqlSoupClient()
          .mutation(DeletePropertyOptionDocument, {
            propertyDefinitionId,
            optionId,
          })
          .toPromise(),
      { waitForCommit: false, onLateFailure }
    );
    span.setAttr('property.outcome', outcome.kind);
  });
}

export async function deletePropertyDefinition(
  propertyDefinitionId: string,
  onLateFailure: (error: Error) => void
): Promise<void> {
  await Telemetry.span('property_catalog.delete_definition', async (span) => {
    span.setAttr('property.definition_id', propertyDefinitionId);
    const outcome = await settle(
      () =>
        getGraphqlSoupClient()
          .mutation(DeletePropertyDefinitionDocument, { propertyDefinitionId })
          .toPromise(),
      { waitForCommit: false, onLateFailure }
    );
    span.setAttr('property.outcome', outcome.kind);
  });
}

// ---------------------------------------------------------------------------
// Added under a client-minted id

/** The cached tag sets, without a request: which scope owns a definition. */
async function cachedTagScopeOf(propertyDefinitionId: string) {
  const mounted = catalogReaders().flatMap((reader) =>
    reader.kind === 'tags' ? reader.definitions() : []
  );
  const fromReader = mounted.find(
    (set) => set.definitionId === propertyDefinitionId
  );
  if (fromReader) return fromReader.scope;
  const cached = await getGraphqlSoupClient()
    .query(PropertyCatalogTagSetsDocument, {}, { requestPolicy: 'cache-only' })
    .toPromise();
  return cached.data?.user.tagSets.find(
    (set) => set.definition?.id === propertyDefinitionId
  )?.scope;
}

/** Cached lists the new option belongs in; lists not in the cache are skipped. */
async function optionListLinks(
  propertyDefinitionId: string,
  option: { __typename: 'GraphqlPropertyOption'; id: string }
): Promise<OptimisticUpdate[]> {
  const links = [
    update(
      select(PropertyCatalogOptionsDocument, { propertyDefinitionId })
        .field('user')
        .field('propertyOptions'),
      prependUnique(option)
    ),
  ];
  // A definition's options are one field of its record, so linking through
  // one list that holds it updates every list that does.
  const withOptions = catalogReaders().find(
    (reader) =>
      reader.kind === 'definitions' &&
      reader.withOptions &&
      reader.definitionIds().includes(propertyDefinitionId)
  );
  const variables =
    withOptions?.kind === 'definitions' ? withOptions.variables() : undefined;
  if (variables) {
    links.push(
      update(
        select(PropertyCatalogDefinitionsWithOptionsDocument, {
          scope: variables.scope,
          forEntityType: variables.forEntityType ?? null,
        })
          .field('user')
          .field('propertyDefinitions')
          .item('id', propertyDefinitionId)
          .field('options'),
        prependUnique(option)
      )
    );
  }
  const scope = await cachedTagScopeOf(propertyDefinitionId);
  if (scope) {
    links.push(
      update(
        select(PropertyCatalogTagSetsDocument, {})
          .field('user')
          .field('tagSets')
          .item('scope', scope)
          .field('options'),
        prependUnique(option)
      )
    );
  }
  return links;
}

/**
 * Adds an option under an id minted here. The server creates it under that
 * id, and a replay of the same add answers with the option the first attempt
 * made, so a queued add can resolve at once and the id it returns is final.
 * A refusal that arrives after a queued add resolved goes to `onLateFailure`;
 * the cache has removed the option by then.
 */
export async function addPropertyOption(
  propertyDefinitionId: string,
  request: AddPropertyOptionRequest,
  onLateFailure: (error: Error) => void
): Promise<PropertyOption> {
  return Telemetry.span('property_catalog.add_option', async (span) => {
    span.setAttr('property.definition_id', propertyDefinitionId);
    const id = uuidv4();
    span.setAttr('property.option_id', id);
    const input = { ...toAddOptionInput(propertyDefinitionId, request), id };
    const client = getGraphqlSoupClient();
    const host = getGraphqlSoupCacheHost();
    const now = new Date().toISOString();
    const option = {
      __typename: 'GraphqlPropertyOption' as const,
      id,
      propertyDefinitionId,
      displayOrder: input.displayOrder,
      value: optionValueRecord(input.value),
      color: input.color ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const outcome = await settle<
      AddPropertyOptionMutation,
      { input: typeof input }
    >(
      async () =>
        host
          ? executeOptimisticMutation(
              client,
              AddPropertyOptionDocument,
              { input },
              { addPropertyOption: option },
              {
                uuid: id,
                updates: await optionListLinks(propertyDefinitionId, option),
              }
            ).toPromise()
          : client.mutation(AddPropertyOptionDocument, { input }).toPromise(),
      { waitForCommit: false, onLateFailure }
    );
    span.setAttr('property.outcome', outcome.kind);
    const created =
      outcome.kind === 'committed' ? outcome.data?.addPropertyOption : option;
    const mapped = created && toPropertyOption(created);
    if (!mapped) noData('addPropertyOption');
    return mapped;
  });
}

// ---------------------------------------------------------------------------
// Answered by the server

/** Which definitions lists a new definition of this scope appears in. */
function holdsNewDefinition(scope: CreatePropertyDefinitionRequest['scope']) {
  const listed = scope === 'team' ? 'TEAM' : 'USER';
  return (reader: CatalogReader) => {
    if (reader.kind !== 'definitions') return false;
    const variables = reader.variables();
    // Definitions a viewer creates apply to every entity type.
    return variables?.scope === 'ALL' || variables?.scope === listed;
  };
}

export async function createPropertyDefinition(
  body: CreatePropertyDefinitionRequest
): Promise<PropertyDefinition> {
  return Telemetry.span('property_catalog.create_definition', async (span) => {
    span.setAttr('property.scope', body.scope);
    span.setAttr('property.data_type', body.data_type.type);
    const outcome = await settle(
      () =>
        getGraphqlSoupClient()
          .mutation(
            CreatePropertyDefinitionDocument,
            { input: toCreateDefinitionInput(body) },
            { optimisticMutation: false }
          )
          .toPromise(),
      { waitForCommit: true }
    );
    const created =
      outcome.kind === 'committed'
        ? outcome.data?.createPropertyDefinition
        : undefined;
    const mapped = created && toPropertyDefinition(created);
    if (!mapped) noData('createPropertyDefinition');
    span.setAttr('property.definition_id', mapped.id);
    // The server places it by name; the lists that hold it reload in order.
    if (usingCache())
      refreshCatalogReadersInBackground(
        ['definitions'],
        holdsNewDefinition(body.scope)
      );
    return mapped;
  });
}

/** Provisions (gets or creates) the viewer's tag set for a scope. */
export async function ensureTagSet(scope: TagScope): Promise<TagSetResponse> {
  return Telemetry.span('property_catalog.ensure_tag_set', async (span) => {
    span.setAttr('property.scope', scope);
    const client = getGraphqlSoupClient();
    const outcome = await settle(
      () =>
        client
          .mutation(
            EnsureTagSetDocument,
            { scope: toGraphqlTagScope(scope) },
            { optimisticMutation: false }
          )
          .toPromise(),
      { waitForCommit: true }
    );
    const set =
      outcome.kind === 'committed' ? outcome.data?.ensureTagSet : undefined;
    const mapped = set && toTagSet(set);
    if (!mapped?.definition) noData('ensureTagSet');
    span.setAttr('property.definition_id', mapped.definition.id);
    if (usingCache()) {
      // Provisioning fills a set the cached list holds as empty. A set that is
      // already listed with its definition has nothing to reload.
      const cached = await client
        .query(
          PropertyCatalogTagSetsDocument,
          {},
          { requestPolicy: 'cache-only' }
        )
        .toPromise();
      const listed = cached.data?.user.tagSets.some(
        (candidate) => candidate.definition?.id === mapped.definition?.id
      );
      span.setAttr('property.reloaded', !listed);
      if (!listed) {
        await client
          .query(
            PropertyCatalogTagSetsDocument,
            {},
            { requestPolicy: 'network-only' }
          )
          .toPromise();
      }
    }
    return mapped;
  });
}

/**
 * Sharing or replacing a tag moves it between definitions and rewrites the
 * values of every entity that carries it, so every catalog list and the
 * cached entity values reload.
 */
function afterTagRemap() {
  if (usingCache()) refreshCatalogReadersInBackground();
  queryClient.invalidateQueries({ queryKey: propertiesKeys._def });
}

/** The team already has a label by this name; offer to replace instead. */
export class TagNameConflictError extends CatalogMutationError {
  constructor(
    message: string,
    readonly conflictingOption: PropertyOptionResponse
  ) {
    super(message, 'TAG_NAME_CONFLICT');
    this.name = 'TagNameConflictError';
  }
}

export async function promoteTag(
  optionId: string
): Promise<PropertyOptionResponse> {
  return Telemetry.span('property_catalog.promote_tag', async (span) => {
    span.setAttr('property.option_id', optionId);
    const outcome = await settle(
      () =>
        getGraphqlSoupClient()
          .mutation(
            PromoteTagDocument,
            { optionId },
            { optimisticMutation: false }
          )
          .toPromise(),
      { waitForCommit: true }
    );
    const promoted =
      outcome.kind === 'committed' ? outcome.data?.promoteTag : undefined;
    if (!promoted) noData('promoteTag');
    if (promoted.__typename === 'GraphqlTagPromotionConflict') {
      span.setAttr('property.outcome', 'conflict');
      const conflicting = toTagOption(promoted.conflictingOption);
      if (!conflicting) noData('promoteTag');
      throw new TagNameConflictError(promoted.message, conflicting);
    }
    const option = toTagOption(promoted.option);
    if (!option) noData('promoteTag');
    span.setAttr('property.outcome', 'promoted');
    afterTagRemap();
    return option;
  });
}

export async function mergeTag(
  optionId: string,
  targetOptionId: string
): Promise<PropertyOptionResponse> {
  return Telemetry.span('property_catalog.merge_tag', async (span) => {
    span.setAttr('property.option_id', optionId);
    span.setAttr('property.target_option_id', targetOptionId);
    const outcome = await settle(
      () =>
        getGraphqlSoupClient()
          .mutation(
            MergeTagDocument,
            { optionId, targetOptionId },
            { optimisticMutation: false }
          )
          .toPromise(),
      { waitForCommit: true }
    );
    const merged =
      outcome.kind === 'committed' ? outcome.data?.mergeTag : undefined;
    const option = merged && toTagOption(merged.option);
    if (!option) noData('mergeTag');
    afterTagRemap();
    return option;
  });
}

/** Reload every catalog list on screen and the cached entity values. */
export async function refreshPropertyCatalog(): Promise<void> {
  queryClient.invalidateQueries({ queryKey: propertiesKeys._def });
  await refreshCatalogReaders();
}

/** Reload the tag sets on screen. */
export function refreshTagSets(): void {
  refreshCatalogReadersInBackground(['tags']);
}

/**
 * The viewer's provisioned set for a scope as the cache holds it, without a
 * request. Provisioning is idempotent, so a cached definition stays valid and
 * a tag can be created at once, offline included.
 */
export async function cachedTagSet(
  scope: TagScope
): Promise<TagSetResponse | undefined> {
  if (!usingCache()) return undefined;
  const cached = await getGraphqlSoupClient()
    .query(PropertyCatalogTagSetsDocument, {}, { requestPolicy: 'cache-only' })
    .toPromise();
  const set = cached.data?.user.tagSets.find(
    (candidate) => candidate.scope === toGraphqlTagScope(scope)
  );
  const mapped = set && toTagSet(set);
  return mapped?.definition ? mapped : undefined;
}
