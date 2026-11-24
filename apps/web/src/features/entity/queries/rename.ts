import { renameDatabase } from '@block-database/queries/rename-database';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import { renameAgentSession } from '@queries/agent-session/entity-mutations';
import {
  assertQueryAccount,
  currentQueryAccount,
  isCurrentQueryAccount,
  mutationQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { useQueryAccount } from '@queries/auth/use-query-account';
import { callKeys } from '@queries/call/keys';
import { refreshChannelDirectory } from '@queries/channel/directory';
import { queryClient } from '@queries/client';
import { setHistoryItemName } from '@queries/history/history';
import { historyKeys } from '@queries/history/keys';
import { setPreviewName } from '@queries/preview';
import { refreshActiveGraphqlPreviewQueries } from '@queries/preview/active-queries';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
  type SoupTransaction,
} from '@queries/soup/cache';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { soupKeys } from '@queries/soup/keys';
import { ownTouchStamp } from '@queries/soup/normalized-cache/own-touch';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { ItemType } from '@service-storage/client';
import { ChannelTypeEnum } from '@service-storage/client';
import {
  type GraphqlEntityType,
  RenameEntitiesDocument,
  type RenameEntitiesMutation,
  type RenameEntitiesMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getEntityGraphqlClient,
  getGraphqlCacheHost,
} from '@service-storage/graphql-soup';
import {
  type MutationFunctionContext,
  useMutation,
} from '@tanstack/solid-query';
import type { EntityData } from '../types/entity';

type RenamableEntity = Pick<EntityData, 'id' | 'type' | 'name'> &
  Partial<EntityData>;

type EntityRenameOperation = {
  entity: RenamableEntity;
  newName: string;
};

type EntityRenameOperationResult = {
  success: boolean;
  queued?: boolean;
};

// Keyed by the full entity identity so heterogeneous or duplicate IDs cannot
// overwrite another operation's rollback transaction.
type SoupTransactionMap = Map<string, SoupTransaction>;

type RenameRollbackContext = {
  account: QueryAccount | undefined;
  soupTransactions: SoupTransactionMap;
};

type EntityRenameData = {
  id: string;
  itemType: EntityData['type'];
  oldName: string;
  newName: string;
};

type EntityRenameOptimisticInfo = Omit<EntityRenameData, 'oldName'>;

type RenameDssEntityMutationVariables = EntityRenameOperation;

type BulkRenameDssEntityMutationVariables = RenameDssEntityMutationVariables[];

type RenameDssEntityMutationData = EntityRenameOperationResult;

type BulkRenameDssEntityMutationData = RenameDssEntityMutationData[];

const MAX_ENTITY_MUTATION_BATCH = 100;

const soupTransactionKey = (itemType: ItemType, id: string): string =>
  `${itemType}:${id}`;

const validateBulkRename = (
  params: BulkRenameDssEntityMutationVariables
): void => {
  const seen = new Set<string>();
  for (const { entity } of params) {
    validateEntityRename(entity);
    const key = `${entity.type}:${entity.id}`;
    if (seen.has(key)) {
      throw new Error(`Bulk rename contains duplicate entity ${key}`);
    }
    seen.add(key);
  }
};

type RenameOnMutateResult = {
  contexts: RenameRollbackContext;
  updates: EntityRenameData[];
};

const getEntityRenameData = (
  operation: EntityRenameOperation
): EntityRenameData | null => {
  const { entity, newName } = operation;
  // crm companies/contacts aren't renamable and have no storage item type.
  // Reminders aren't either — the entity-mutation router rejects them, and a
  // reminder's name is its description, edited through the reminders API.
  // Calendar event titles are edited through the calendar mutation API.
  // Databases go through `renameDatabase` (not Soup optimism); forms through
  // `renameForm` on the form block.
  if (
    entity.type === 'crm_company' ||
    entity.type === 'crm_contact' ||
    entity.type === 'calendar_event' ||
    entity.type === 'initiative' ||
    entity.type === 'database' ||
    entity.type === 'form'
  ) {
    return null;
  }
  return {
    id: entity.id,
    itemType: entity.type,
    oldName: entity.name,
    newName,
  };
};

const performEntityRename = async (operation: EntityRenameOperation) => {
  if (operation.entity.type === 'database') {
    if (operation.newName.trim() === operation.entity.name) {
      return { success: true };
    }
    const renamed = await renameDatabase(
      getEntityGraphqlClient(),
      operation.entity.id,
      operation.newName
    );
    if (renamed.isErr()) {
      console.error('Failed to rename database', renamed.error);
    }
    return { success: renamed.isOk() };
  }
  if (operation.entity.type === 'agent_session') {
    await renameAgentSession(operation.entity.id, operation.newName);
    return { success: true };
  }
  return { success: false };
};

function graphqlRenameType(
  entity: RenamableEntity
): GraphqlEntityType | undefined {
  switch (entity.type) {
    case 'document':
      return 'DOCUMENT';
    case 'chat':
      return 'CHAT';
    case 'project':
      return 'PROJECT';
    case 'channel':
      return 'CHANNEL';
    case 'call':
      return 'CALL';
    default:
      return undefined;
  }
}

async function performGraphqlRenames(
  operations: EntityRenameOperation[]
): Promise<RenameDssEntityMutationData[]> {
  const inputs = operations.map(({ entity, newName }) => {
    const type = graphqlRenameType(entity);
    if (!type) throw new Error(`Unsupported GraphQL rename: ${entity.type}`);
    return {
      entity: { type, id: entity.id },
      displayName: newName,
    };
  });
  const uuid = crypto.randomUUID();
  const settlement = observeRenameSettlement(uuid, operations);
  let queued = false;
  try {
    const result = await getEntityGraphqlClient()
      .mutation<RenameEntitiesMutation, RenameEntitiesMutationVariables>(
        RenameEntitiesDocument,
        { inputs },
        { optimisticMutation: { uuid } }
      )
      .toPromise();
    const disposition = optimisticMutationDispositionOf(result);
    if (disposition?.kind === 'queued') {
      queued = true;
      return operations.map(() => ({ success: true, queued: true }));
    }
    if (disposition?.kind === 'permanently-failed') throw disposition.error;
    if (result.error) throw result.error;
    if (!result.data && disposition?.kind === 'committed') {
      // Preserve accepted edits until fresh reads can establish each result.
      return operations.map(() => ({ success: true, queued: true }));
    }
    if (!result.data) throw new Error('GraphQL rename returned no data');
    return result.data.renameEntities.results.map((result) => ({
      success: result.__typename === 'GraphqlMutationSuccess',
    }));
  } finally {
    if (!queued) settlement.complete();
  }
}

/** Legacy readers refetch confirmed state; the normalized layer owns optimism. */
function observeRenameSettlement(
  uuid: string,
  operations: EntityRenameOperation[]
) {
  const host = getGraphqlCacheHost();
  const account = currentQueryAccount();
  let finished = false;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeReset: (() => void) | undefined;
  const dispose = () => {
    unsubscribe?.();
    unsubscribeReset?.();
  };
  const refresh = async () => {
    if (!isCurrentQueryAccount(account)) return;
    const requests = [
      queryClient.invalidateQueries({ queryKey: historyKeys.list.queryKey }),
      queryClient.invalidateQueries({ queryKey: soupKeys._def }),
    ];
    const channelIds = operations.flatMap(({ entity }) =>
      entity.type === 'channel' ? [entity.id] : []
    );
    if (channelIds.length > 0)
      requests.push(refreshChannelDirectory(channelIds));
    for (const { entity } of operations) {
      if (entity.type === 'call')
        requests.push(
          queryClient.invalidateQueries({
            queryKey: callKeys.record(entity.id).queryKey,
          })
        );
      if (!host || host.disabled)
        requests.push(refreshActiveGraphqlPreviewQueries(entity.id));
    }
    if (!host || host.disabled)
      requests.push(refreshActiveGraphqlSoupQueries());
    await Promise.allSettled(requests);
  };
  const complete = () => {
    if (finished) return;
    finished = true;
    dispose();
    fireAndForget(refresh(), 'entity-rename');
  };
  unsubscribe = host?.onMutationSettled((settlement) => {
    if (settlement.mutationUuid === uuid && settlement.status !== 'superseded')
      complete();
  });
  unsubscribeReset = host?.onCacheGenerationChanged((change) => {
    if (change.storage === 'reset') {
      finished = true;
      dispose();
    }
  });
  return { complete };
}

const validateEntityRename = (entity: RenamableEntity): void => {
  switch (entity.type) {
    case 'channel':
      // NOTE: channel type is undefined if provided from the split modal due to casting in createEntityData
      if (entity.channelType === ChannelTypeEnum.DirectMessage) {
        throw new Error('Direct messages do not support renaming');
      }
      break;
    case 'agent_session':
    case 'document':
    case 'chat':
    case 'project':
    case 'call':
    case 'database':
      return;
    case 'foreign':
      throw new Error('Foreign entities do not support renaming');
    default:
      throw new Error(`Unsupported entity type: ${entity.type}`);
  }
};

const renameDssSetData = (
  entities: EntityRenameOptimisticInfo[]
): SoupTransactionMap => {
  const txns: SoupTransactionMap = new Map();
  for (const { id, itemType, newName } of entities) {
    if (itemType !== 'agent_session') continue;
    const current = getSoupEntityById(id);
    txns.set(
      soupTransactionKey(itemType, id),
      optimisticUpdateSoupEntity({
        tag: 'agentSession',
        data: { id, name: newName },
        frecency_score: current?.frecency_score ?? 0,
        // A rename is an Edited activity, i.e. a touch (own-touch.ts).
        touched_at: ownTouchStamp(id),
      })
    );
  }
  return txns;
};

const renamePreviewSetData = (entities: EntityRenameOptimisticInfo[]) => {
  entities.forEach(({ id, newName, itemType }) => {
    // Calendar event previews are API-served projections keyed to the
    // viewer's copy; renames flow through calendar mutations instead.
    if (itemType === 'calendar_event') return;
    setPreviewName({
      itemId: id,
      name: newName,
      itemType,
    });
  });
};

const renameHistorySetData = (entities: EntityRenameOptimisticInfo[]) => {
  entities.forEach(({ id, newName }) => {
    setHistoryItemName(id, newName);
  });
};

function performOptimisticRenameUpdates(
  entities: EntityRenameOptimisticInfo[],
  account: QueryAccount
): RenameRollbackContext {
  // A durable queued write can fail after the mutation callback has returned.
  // Only REST operations may write the legacy caches before confirmation.
  entities = entities.filter(
    ({ id, itemType, newName }) =>
      !graphqlRenameType({ id, type: itemType, name: newName })
  );
  renamePreviewSetData(entities);
  renameHistorySetData(entities);
  const soupTransactions = renameDssSetData(entities);

  return { soupTransactions, account };
}

function rollbackOptimisticRenameUpdates({
  contexts,
  updates,
}: RenameOnMutateResult): void {
  if (!isCurrentQueryAccount(contexts.account)) return;
  for (const [, txn] of contexts.soupTransactions) {
    txn.rollback();
  }

  const rollbackEntities = updates
    .filter(({ id, itemType }) =>
      contexts.soupTransactions.has(soupTransactionKey(itemType, id))
    )
    .map(({ id, oldName, itemType }) => ({
      id,
      itemType,
      newName: oldName,
    }));

  renameHistorySetData(rollbackEntities);
  renamePreviewSetData(rollbackEntities);
}

const bulkRenameMutationFn = async (
  params: BulkRenameDssEntityMutationVariables,
  context: MutationFunctionContext
): Promise<BulkRenameDssEntityMutationData> => {
  assertQueryAccount(mutationQueryAccount(context));
  validateBulkRename(params);

  const results: Array<RenameDssEntityMutationData | undefined> = new Array(
    params.length
  );
  const graphqlOperations = params
    .map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => graphqlRenameType(operation.entity));
  const legacyOperations = params
    .map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => !graphqlRenameType(operation.entity));
  if (graphqlOperations.length > MAX_ENTITY_MUTATION_BATCH) {
    throw new Error(
      `Bulk rename accepts at most ${MAX_ENTITY_MUTATION_BATCH} GraphQL entities`
    );
  }

  const [graphqlResults, legacyResults] = await Promise.all([
    graphqlOperations.length > 0
      ? performGraphqlRenames(
          graphqlOperations.map(({ operation }) => operation)
        ).catch((error) => {
          console.error('GraphQL rename batch failed', error);
          return graphqlOperations.map(() => ({ success: false }));
        })
      : Promise.resolve([]),
    Promise.all(
      legacyOperations.map(async ({ operation }) => {
        try {
          return await performEntityRename(operation);
        } catch (error) {
          console.error('Legacy rename failed', operation, error);
          return { success: false };
        }
      })
    ),
  ]);
  graphqlOperations.forEach(({ index }, resultIndex) => {
    results[index] = graphqlResults[resultIndex];
  });
  legacyOperations.forEach(({ index }, resultIndex) => {
    results[index] = legacyResults[resultIndex];
  });

  return results.map((result) => result ?? { success: false });
};

const bulkRenameOnMutate = (
  params: BulkRenameDssEntityMutationVariables,
  context: MutationFunctionContext
): RenameOnMutateResult => {
  const account = mutationQueryAccount(context);
  assertQueryAccount(account);
  // TanStack runs onMutate before mutationFn. Validate before the first cache
  // write so an invalid batch cannot require a best-effort rollback.
  validateBulkRename(params);
  const updates = params
    .map(getEntityRenameData)
    .filter((d): d is EntityRenameData => d !== null);
  const contexts = performOptimisticRenameUpdates(updates, account);
  return { contexts, updates };
};

const bulkRenameOnSettled = (
  data: BulkRenameDssEntityMutationData | undefined,
  error: Error | null,
  params: BulkRenameDssEntityMutationVariables,
  onMutateResult: RenameOnMutateResult | undefined
): void => {
  if (!isCurrentQueryAccount(onMutateResult?.contexts.account)) return;
  const hasFailed = !!error || data?.some((d) => !d.success);
  if (!hasFailed) return;

  console.error(`Failed rename`, params, data, error);
  toast.failure('Failed to rename');

  if (!onMutateResult) {
    // most likely nothing to rollback, but it's possible there were mutations that succeeded before the OnMutate failed
    // TODO: refetch everything to be safe
    return;
  }

  // rollback everything if we can't identify specific failures
  if (!data) {
    rollbackOptimisticRenameUpdates(onMutateResult);
    return;
  }

  // Rollback only the failed items by entity ID
  const failedUpdates: EntityRenameData[] = [];
  const failedSoupTransactions: SoupTransactionMap = new Map();

  data.forEach((result, index) => {
    if (!result.success) {
      const { entity } = params[index];
      const update = onMutateResult.updates.find(
        ({ id, itemType }) => id === entity.id && itemType === entity.type
      );
      if (update) {
        failedUpdates.push(update);
        const key = soupTransactionKey(update.itemType, update.id);
        const txn = onMutateResult.contexts.soupTransactions.get(key);
        if (txn) failedSoupTransactions.set(key, txn);
      }
    }
  });

  // Rollback only the failed items
  if (failedUpdates.length > 0) {
    rollbackOptimisticRenameUpdates({
      contexts: {
        account: onMutateResult.contexts.account,
        soupTransactions: failedSoupTransactions,
      },
      updates: failedUpdates,
    });
  }
};

/** Supports channel/document/chat/project/call/agent-session/database rename. */
export function createRenameDssEntityMutation(
  callbacks?: MutationCallbacks<
    RenameDssEntityMutationData,
    Error,
    RenameDssEntityMutationVariables,
    RenameOnMutateResult
  >
) {
  const account = useQueryAccount();
  return useMutation<
    RenameDssEntityMutationData,
    Error,
    RenameDssEntityMutationVariables,
    RenameOnMutateResult
  >(() => ({
    meta: { queryAccount: account() },
    mutationFn: async (params, context) =>
      (await bulkRenameMutationFn([params], context))[0],
    ...withCallbacks<
      RenameDssEntityMutationData,
      Error,
      RenameDssEntityMutationVariables,
      RenameOnMutateResult
    >(
      {
        onMutate: async (params, context) =>
          bulkRenameOnMutate([params], context),
        onSettled: (data, error, params, onMutateResult) => {
          bulkRenameOnSettled(
            data ? [data] : undefined,
            error,
            [params],
            onMutateResult
          );
        },
      },
      callbacks
    ),
  }));
}

/** Supports channel/document/chat/project/call/agent-session/database bulk rename. */
export function createBulkRenameDssEntityMutation() {
  const account = useQueryAccount();
  return useMutation<
    BulkRenameDssEntityMutationData,
    Error,
    BulkRenameDssEntityMutationVariables,
    RenameOnMutateResult
  >(() => ({
    meta: { queryAccount: account() },
    mutationFn: bulkRenameMutationFn,
    onMutate: bulkRenameOnMutate,
    onSettled: bulkRenameOnSettled,
  }));
}
