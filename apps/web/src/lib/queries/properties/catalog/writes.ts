/**
 * Property catalog writes: GraphQL mutations against the normalized cache.
 *
 * - Updating and deleting an option, and deleting a definition, are predicted
 *   by the resolvers in `resolvers.ts`: every reader shows the change at once,
 *   the cache rolls it back if the server refuses, and offline writes queue.
 * - Adding an option shows it at once under an id minted here, linked into the
 *   cached lists it belongs to. The server creates it under that id and a
 *   replay answers with it. The add resolves once the server has it, so the
 *   id a caller applies to an entity always exists there.
 * - The server orders options of equal display order by value under the
 *   database's collation, which the cache cannot reproduce. Adding an option,
 *   or changing its value or order, reloads the lists holding them once the
 *   server has it, as the invalidation after a REST write did.
 * - Creating a definition, provisioning a tag set, and sharing or replacing a
 *   tag are answered by the server (it assigns ids and owners, and decides
 *   name collisions); the lists that hold them reload after it answers.
 * - A write the server answers waits while the app is offline and goes once
 *   it is back online, as TanStack paused a write started offline; a write
 *   the cache queues shows at once and the queue sends it.
 */

import { crmSnapshotAuthorization } from '@app/lib/urql-solid/authorization';
import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CacheHost,
  executeOptimisticMutation,
  normalizedCacheResultMetadata,
  type OptimisticUpdate,
  optimisticMutationDispositionOf,
  prependUnique,
  readRecordsByKeys,
  select,
  selectRecord,
  selectRecords,
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
  PropertyCatalogDefinitionOptionsFragmentDoc,
  PropertyCatalogOptionsDocument,
  PropertyCatalogTagSetsDocument,
  type PropertyCatalogTagSetsQuery,
  UpdatePropertyOptionDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { onlineManager } from '@tanstack/solid-query';
import {
  type AnyVariables,
  getOperationName,
  type OperationContext,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { ResultAsync } from 'neverthrow';
import { createEffect, createRoot } from 'solid-js';
import { match } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import { queryAccountSession } from '../../auth/account-scope';
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
  markCatalogStale,
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

/**
 * Resolves once the app is online (`onlineManager`, the native network path on
 * iOS and Android), as TanStack held a mutation started offline until then.
 */
export function whenOnline(signal?: AbortSignal): Promise<void> {
  if (onlineManager.isOnline()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = onlineManager.subscribe((online) => {
      if (!online) return;
      unsubscribe();
      resolve();
    });
    // A caller that stopped waiting leaves no listener behind.
    signal?.addEventListener('abort', unsubscribe, { once: true });
  });
}

type Settlements = ReturnType<typeof observePropertyMutationSettlements>;

type SettleOptions = {
  waitForCommit: boolean;
  serverAnswered: boolean;
  onLateFailure?: (error: Error) => void;
  /** Runs once the server has the write, whether it went at once or queued. */
  onCommit?: () => void;
  /** The login session the write's flow began in; the session now when omitted. */
  session?: number;
};

const accountChanged = (when: string) =>
  new CatalogMutationError(
    `Another login took over ${when}`,
    'ACCOUNT_CHANGED'
  );

/** What a write's wait depends on: its login, and the cache holding it. */
type WaitScope = {
  session: number;
  /** The cache the write is queued on; omitted when none holds it. */
  host?: CacheHost;
  when: string;
};

/**
 * Whether a host is paused through an outage: it is not handed out, but keeps
 * its queue and its settlement listeners, and serves again as itself. Hosts
 * that cannot pause have no `paused`.
 */
const isPaused = (host: CacheHost): boolean =>
  'paused' in host && host.paused === true;

/**
 * Why a write's wait ended before its work did, if it did: another login took
 * over, or the cache holding the write stopped (signed out, retired or
 * replaced), which may never report it. A paused cache has not stopped: it
 * reports the write when it serves again.
 */
function waitEnded({
  session,
  host,
  when,
}: WaitScope): CatalogMutationError | undefined {
  if (queryAccountSession() !== session) return accountChanged(when);
  if (host && getGraphqlSoupCacheHost() !== host && !isPaused(host))
    return new CatalogMutationError(
      `The cache stopped ${when}`,
      'CACHE_STOPPED'
    );
  return undefined;
}

/**
 * Waits for `work`, or rejects once the wait ended (`waitEnded`), aborting
 * `work`'s signal. An outcome that arrives as the login changes belongs to
 * the old login; one the cache reported before it stopped still stands.
 */
async function whileWaitHolds<T>(
  scope: WaitScope,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const ended = () => waitEnded(scope);
  const loginEnded = () =>
    queryAccountSession() === scope.session
      ? undefined
      : accountChanged(scope.when);
  const abort = new AbortController();
  let stop = () => {};
  const stopped = new Promise<never>((_, reject) => {
    createRoot((dispose) => {
      stop = dispose;
      createEffect(() => {
        const reason = ended();
        if (reason) reject(reason);
      });
    });
  });
  try {
    const value = await Promise.race([work(abort.signal), stopped]);
    const reason = loginEnded();
    if (reason) throw reason;
    return value;
  } catch (error: unknown) {
    throw loginEnded() ?? error;
  } finally {
    stop();
    abort.abort();
  }
}

/** Waits for a queued write's commit in the background. */
async function observeCommit(
  settlements: Settlements,
  transactionId: string,
  scope: WaitScope,
  options: SettleOptions
): Promise<void> {
  let failure: Error | undefined;
  try {
    await whileWaitHolds(scope, () => settlements.waitForCommit(transactionId));
  } catch (error: unknown) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    settlements.dispose();
  }
  // The old login's write is not this page's to report. Checked here, right
  // before the callbacks, since a login can change after the wait ends.
  if (
    queryAccountSession() !== scope.session ||
    isCatalogErrorCode(failure, 'ACCOUNT_CHANGED')
  )
    return;
  if (!failure) {
    options.onCommit?.();
    return;
  }
  console.error('Queued property catalog write failed', failure);
  options.onLateFailure?.(failure);
}

type Settled<TData> =
  | { kind: 'committed'; data: TData | undefined; waited?: true }
  | { kind: 'queued' };

/**
 * Submits one write and reads its outcome. A queued write (offline, or behind
 * an older write) either waits for its commit, or resolves at once and reports
 * a later refusal through `onLateFailure`; the cache has rolled it back by then.
 * A write that goes straight to the server (`serverAnswered`) waits until the
 * app is online before it is sent, in the trace it was started in, and is
 * dropped if another login took over the page meanwhile, or since the
 * `session` its flow began in.
 */
async function settle<TData, TVariables extends AnyVariables>(
  send: (
    context: Partial<OperationContext>
  ) => Promise<OperationResult<TData, TVariables>>,
  options: SettleOptions
): Promise<Settled<TData>> {
  // Context does not survive an await in the browser, so a write the server
  // answers carries it to its request (see trace-parent-exchange). The cache
  // queue sends the others inside its own attempt span.
  const trace = Telemetry.captureContext();
  const context: Partial<OperationContext> = options.serverAnswered
    ? { [TRACE_PARENT_CONTEXT_KEY]: trace }
    : {};
  const session = options.session ?? queryAccountSession();
  if (options.serverAnswered && !onlineManager.isOnline())
    await whileWaitHolds(
      { session, when: 'before the write was sent' },
      whenOnline
    );
  if (queryAccountSession() !== session)
    throw new CatalogMutationError(
      'Another login took over before the write was sent',
      'ACCOUNT_CHANGED'
    );
  const host = getGraphqlSoupCacheHost();
  const settlements = observePropertyMutationSettlements(host);
  const saving: WaitScope = {
    session,
    host,
    when: 'before the write was saved',
  };
  let observing = false;
  try {
    const result = await trace.run(() => send(context));
    const disposition = optimisticMutationDispositionOf(result);
    if (disposition?.kind === 'queued') {
      if (options.waitForCommit) {
        await whileWaitHolds(saving, () =>
          settlements.waitForCommit(disposition.transactionId)
        );
        // A login can change after the wait ends.
        if (queryAccountSession() !== session)
          throw accountChanged(saving.when);
        options.onCommit?.();
        return { kind: 'committed', data: undefined, waited: true };
      }
      observing = true;
      fireAndForget(
        observeCommit(settlements, disposition.transactionId, saving, options),
        'property-catalog'
      );
      return { kind: 'queued' };
    }
    if (result.error) throw errorOf(result);
    if (disposition?.kind === 'permanently-failed') {
      throw new CatalogMutationError(disposition.error.message);
    }
    options.onCommit?.();
    return { kind: 'committed', data: result.data };
  } finally {
    if (!observing) settlements.dispose();
  }
}

/**
 * How long provisioning waits for its reload to be written to the cache
 * before reading it back: the cache ends a read it cannot answer at 10 s.
 */
const PERSISTENCE_WAIT_MS = 10_000;

/** Waits for a promise, or for `ms`, whichever comes first. */
async function within(promise: Promise<unknown> | undefined, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function noData(operation: string): never {
  throw new CatalogMutationError(`${operation} returned no data`);
}

const usingCache = () => getGraphqlSoupCacheHost() !== undefined;

/** Mounted lists that hold a definition's options. */
function holdsOptionsOf(propertyDefinitionId: string) {
  return (reader: CatalogReader) =>
    match(reader)
      .with(
        { kind: 'options' },
        (options) => options.propertyDefinitionId() === propertyDefinitionId
      )
      .with(
        { kind: 'definitions' },
        (definitions) =>
          definitions.withOptions &&
          definitions.definitionIds().includes(propertyDefinitionId)
      )
      .with({ kind: 'tags' }, (tags) =>
        tags
          .definitions()
          .some((set) => set.definitionId === propertyDefinitionId)
      )
      .exhaustive(() => false);
}

/** Definitions whose option lists wait for a reload, and whether one runs. */
const reorder = { waiting: new Set<string>(), running: false };

/**
 * Puts a definition's options back in the server's order (see the header).
 * One reload runs at a time and covers every definition whose write committed
 * meanwhile, so replaying a queue of writes reloads each list once or twice,
 * not once per write.
 */
function reorderOptionsOf(propertyDefinitionId: string) {
  if (!usingCache()) return;
  reorder.waiting.add(propertyDefinitionId);
  if (!reorder.running) fireAndForget(reorderWaiting(), 'property-catalog');
}

async function reorderWaiting(): Promise<void> {
  reorder.running = true;
  try {
    while (reorder.waiting.size > 0) {
      const ids = [...reorder.waiting];
      reorder.waiting.clear();
      const holders = ids.map(holdsOptionsOf);
      try {
        await refreshCatalogReaders(undefined, (reader) =>
          holders.some((holds) => holds(reader))
        );
      } catch (error: unknown) {
        // A failed reload leaves the cached lists on screen; the writes that
        // committed meanwhile still get theirs.
        console.error('Property option reload failed', error);
      }
    }
  } finally {
    reorder.running = false;
  }
}

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
      (context) =>
        getGraphqlSoupClient()
          .mutation(
            UpdatePropertyOptionDocument,
            {
              input: {
                propertyDefinitionId,
                optionId,
                ...(body.value != null ? { value: body.value } : {}),
                ...(body.color != null ? { color: body.color } : {}),
                ...(body.display_order != null
                  ? { displayOrder: body.display_order }
                  : {}),
              },
            },
            context
          )
          .toPromise(),
      {
        waitForCommit: false,
        serverAnswered: !usingCache(),
        onLateFailure,
        ...(body.value != null || body.display_order != null
          ? { onCommit: () => reorderOptionsOf(propertyDefinitionId) }
          : {}),
      }
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
      (context) =>
        getGraphqlSoupClient()
          .mutation(
            DeletePropertyOptionDocument,
            { propertyDefinitionId, optionId },
            context
          )
          .toPromise(),
      { waitForCommit: false, serverAnswered: !usingCache(), onLateFailure }
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
      (context) =>
        getGraphqlSoupClient()
          .mutation(
            DeletePropertyDefinitionDocument,
            { propertyDefinitionId },
            context
          )
          .toPromise(),
      { waitForCommit: false, serverAnswered: !usingCache(), onLateFailure }
    );
    // An editor mounted for the deleted definition asks the server again,
    // which refuses it, rather than showing the options the cache holds.
    markCatalogStale(['options']);
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

/**
 * Whether the cache holds a definition's options on its record. A link
 * through a record the cache lacks is refused, and the cache then drops every
 * link of the write.
 */
async function cachedDefinitionOptions(
  host: CacheHost,
  propertyDefinitionId: string
): Promise<boolean> {
  try {
    const { records } = await readRecordsByKeys(
      host,
      selectRecords(PropertyCatalogDefinitionOptionsFragmentDoc),
      [`GraphqlPropertyDefinition:${propertyDefinitionId}`]
    );
    return records.length > 0;
  } catch (error: unknown) {
    // Without the record link the add still shows in the lists linked by query.
    console.error('Reading the cached property definition failed', error);
    return false;
  }
}

/** Cached lists the new option belongs in; lists not in the cache are skipped. */
async function optionListLinks(
  host: CacheHost,
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
  // the record updates every list that holds it, cached or on screen.
  if (await cachedDefinitionOptions(host, propertyDefinitionId)) {
    links.push(
      update(
        selectRecord(PropertyCatalogDefinitionOptionsFragmentDoc, {
          __typename: 'GraphqlPropertyDefinition',
          id: propertyDefinitionId,
        }).field('options'),
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
 * Adds an option under an id minted here. Readers show it at once; the
 * server creates it under that id, and a replay of the same add answers with
 * the option the first attempt made. Resolves once the server has it (a
 * queued add waits for its commit, as TanStack paused an offline write), so
 * callers never apply an id the server could still refuse; a refusal rejects
 * after the cache has removed the option. A caller whose flow began before
 * this call (a tag created after its set was provisioned) passes the login
 * session it began under; the add is dropped if another login took over.
 */
export async function addPropertyOption(
  propertyDefinitionId: string,
  request: AddPropertyOptionRequest,
  started: { session?: number } = {}
): Promise<PropertyOption> {
  const session = started.session ?? queryAccountSession();
  return Telemetry.span('property_catalog.add_option', async (span) => {
    if (queryAccountSession() !== session)
      throw new CatalogMutationError(
        'Another login took over before the add was sent',
        'ACCOUNT_CHANGED'
      );
    span.setAttr('property.definition_id', propertyDefinitionId);
    const id = uuidv7();
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
    // Context does not survive the await for the links, so the enqueue runs
    // in the trace the add started in, and only under the login that made it.
    // The links are read from the cache, so they carry the cache generation
    // they were read under.
    const parent = Telemetry.captureContext();
    const enqueue = async (cacheHost: CacheHost) => {
      const authorizationEpoch = crmSnapshotAuthorization().epoch;
      const updates = await optionListLinks(
        cacheHost,
        propertyDefinitionId,
        option
      );
      if (queryAccountSession() !== session)
        throw new CatalogMutationError(
          'Another login took over while the add read the cache',
          'ACCOUNT_CHANGED'
        );
      return parent.run(() =>
        executeOptimisticMutation(
          client,
          AddPropertyOptionDocument,
          { input },
          { addPropertyOption: option },
          { uuid: id, updates, authorizationEpoch }
        ).toPromise()
      );
    };
    const outcome = await settle<
      AddPropertyOptionMutation,
      { input: typeof input }
    >(
      async (context) =>
        host
          ? enqueue(host)
          : client
              .mutation(AddPropertyOptionDocument, { input }, context)
              .toPromise(),
      {
        waitForCommit: true,
        serverAnswered: !host,
        onCommit: () => reorderOptionsOf(propertyDefinitionId),
      }
    );
    span.setAttr(
      'property.outcome',
      outcome.kind === 'committed' && outcome.waited ? 'queued' : outcome.kind
    );
    // A queued add commits under the id sent, so the local record is the
    // option the server made.
    const created =
      (outcome.kind === 'committed'
        ? outcome.data?.addPropertyOption
        : undefined) ?? option;
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
      (context) =>
        getGraphqlSoupClient()
          .mutation(
            CreatePropertyDefinitionDocument,
            { input: toCreateDefinitionInput(body) },
            { optimisticMutation: false, ...context }
          )
          .toPromise(),
      { waitForCommit: true, serverAnswered: true }
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
export async function ensureTagSet(
  scope: TagScope,
  started: { session?: number } = {}
): Promise<TagSetResponse> {
  return Telemetry.span('property_catalog.ensure_tag_set', async (span) => {
    span.setAttr('property.scope', scope);
    const session = started.session ?? queryAccountSession();
    const client = getGraphqlSoupClient();
    const outcome = await settle(
      (context) =>
        client
          .mutation(
            EnsureTagSetDocument,
            { scope: toGraphqlTagScope(scope) },
            { optimisticMutation: false, ...context }
          )
          .toPromise(),
      { waitForCommit: true, serverAnswered: true, session }
    );
    const set =
      outcome.kind === 'committed' ? outcome.data?.ensureTagSet : undefined;
    const mapped = set && toTagSet(set);
    if (!mapped?.definition) noData('ensureTagSet');
    span.setAttr('property.definition_id', mapped.definition.id);
    const host = getGraphqlSoupCacheHost();
    if (host) {
      // Provisioning fills a set the cached list holds as empty. A set that is
      // already listed with its definition has nothing to reload.
      const definitionId = mapped.definition.id;
      // Read from the store itself: a cache-only client query can share an
      // in-flight network answer that the cache has not written.
      const listed = async () => {
        const cached = await host.readQuery({
          query: stringifyDocument(PropertyCatalogTagSetsDocument),
          operationName: getOperationName(PropertyCatalogTagSetsDocument),
          variables: {},
        });
        if (cached.kind === 'miss') return false;
        const data = cached.data as PropertyCatalogTagSetsQuery;
        return data.user.tagSets.some(
          (candidate) => candidate.definition?.id === definitionId
        );
      };
      // The cache may not answer at all (a read waiting on another tab's
      // engine ends unanswered); a failed read is not a negative one.
      const readListed = async () => {
        const read = await ResultAsync.fromPromise(
          listed(),
          (error: unknown) => error
        );
        if (read.isErr())
          console.error('Reading the cached tag sets failed', read.error);
        return read;
      };
      const before = await readListed();
      const wasListed = before.isOk() && before.value;
      span.setAttr('property.reloaded', !wasListed);
      if (!wasListed) {
        const reloaded = await client
          .query(
            PropertyCatalogTagSetsDocument,
            {},
            { requestPolicy: 'network-only' }
          )
          .toPromise();
        // A tag added to a set the cache does not list would show nowhere.
        // Provisioning is idempotent, so the caller can simply try again.
        if (reloaded.error) throw errorOf(reloaded);
        // The caller's next add reads the list from the cache, so the set
        // counts as ready once the cache holds it. A cache that cannot answer
        // is not the cache refusing the set: the readers on screen shared the
        // reload, so its own answer decides then.
        const metadata = normalizedCacheResultMetadata(reloaded);
        if (metadata?.source === 'live-network')
          await within(metadata.persistence, PERSISTENCE_WAIT_MS);
        const after = await readListed();
        const ready = after.isOk()
          ? after.value
          : (reloaded.data?.user.tagSets.some(
              (candidate) => candidate.definition?.id === definitionId
            ) ?? false);
        span.setAttr('property.cache_answered', after.isOk());
        if (!ready) noData('ensureTagSet reload');
      }
    }
    // The set is the login's that asked for it; reading it back can outlast
    // that login.
    if (queryAccountSession() !== session)
      throw accountChanged('while the tag set was provisioned');
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
      (context) =>
        getGraphqlSoupClient()
          .mutation(
            PromoteTagDocument,
            { optionId },
            { optimisticMutation: false, ...context }
          )
          .toPromise(),
      { waitForCommit: true, serverAnswered: true }
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
      (context) =>
        getGraphqlSoupClient()
          .mutation(
            MergeTagDocument,
            { optionId, targetOptionId },
            { optimisticMutation: false, ...context }
          )
          .toPromise(),
      { waitForCommit: true, serverAnswered: true }
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
 * a tag can be created at once, offline included. A cache that cannot answer
 * answers nothing, and the caller asks the server. A flow that began under
 * `session` finds nothing once another login took over.
 */
export async function cachedTagSet(
  scope: TagScope,
  session = queryAccountSession()
): Promise<TagSetResponse | undefined> {
  if (!usingCache()) return undefined;
  const cached = await getGraphqlSoupClient()
    .query(PropertyCatalogTagSetsDocument, {}, { requestPolicy: 'cache-only' })
    .toPromise();
  if (queryAccountSession() !== session) return undefined;
  const set = cached.data?.user.tagSets.find(
    (candidate) => candidate.scope === toGraphqlTagScope(scope)
  );
  const mapped = set && toTagSet(set);
  return mapped?.definition ? mapped : undefined;
}
