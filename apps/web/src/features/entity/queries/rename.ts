import { renameItem } from '@core/component/FileList/itemOperations';
import { toast } from '@core/component/Toast/Toast';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { callKeys } from '@queries/call/keys';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { setHistoryItemName } from '@queries/history/history';
import { setPreviewName } from '@queries/preview';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
  type SoupTransaction,
} from '@queries/soup/cache';
import { ownTouchStamp } from '@queries/soup/normalized-cache/own-touch';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { CallRecord } from '@service-call/client';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ItemType } from '@service-storage/client';
import { ChannelTypeEnum } from '@service-storage/client';
import {
  type GraphqlEntityType,
  RenameEntitiesDocument,
  type RenameEntitiesMutation,
  type RenameEntitiesMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { useMutation } from '@tanstack/solid-query';
import type { EntityData } from '../types/entity';

type RenamableEntity = Pick<EntityData, 'id' | 'type' | 'name'> &
  Partial<EntityData>;

type EntityRenameOperation = {
  entity: RenamableEntity;
  newName: string;
};

type EntityRenameOperationResult = {
  success: boolean;
};

// Keyed by the full entity identity so heterogeneous or duplicate IDs cannot
// overwrite another operation's rollback transaction.
type SoupTransactionMap = Map<string, SoupTransaction>;

type RenameRollbackContext = {
  soupTransactions: SoupTransactionMap;
};

type EntityRenameData = {
  id: string;
  itemType: ItemType;
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
  if (
    entity.type === 'crm_company' ||
    entity.type === 'crm_contact' ||
    entity.type === 'reminder' ||
    entity.type === 'calendar_event'
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
  const data = getEntityRenameData(operation);
  if (!data) return { success: false };
  const success = await renameItem(data);
  return { success };
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
  const result = await getEntityGraphqlClient()
    .mutation<RenameEntitiesMutation, RenameEntitiesMutationVariables>(
      RenameEntitiesDocument,
      { inputs }
    )
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('GraphQL rename returned no data');
  return result.data.renameEntities.results.map((result) => ({
    success: result.__typename === 'GraphqlMutationSuccess',
  }));
}

const validateEntityRename = (entity: RenamableEntity): void => {
  switch (entity.type) {
    case 'channel':
      // NOTE: channel type is undefined if provided from the split modal due to casting in createEntityData
      if (entity.channelType === ChannelTypeEnum.DirectMessage) {
        throw new Error('Direct messages do not support renaming');
      }
      break;
    case 'document':
    case 'chat':
    case 'project':
    case 'call':
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
  // A rename is an Edited activity, i.e. a touch (own-touch.ts).
  for (const { id, itemType, newName } of entities) {
    const current = getSoupEntityById(id);
    const score = current?.frecency_score ?? 0;
    if (itemType === 'channel') {
      txns.set(
        soupTransactionKey(itemType, id),
        optimisticUpdateSoupEntity({
          tag: 'channel',
          data: { channel: { id, name: newName } },
          frecency_score: score,
          touched_at: ownTouchStamp(id),
        })
      );
    } else if (itemType === 'call') {
      txns.set(
        soupTransactionKey(itemType, id),
        optimisticUpdateSoupEntity({
          tag: 'call',
          data: { callId: id, customName: newName },
          frecency_score: score,
        })
      );
    } else if (
      itemType !== 'email' &&
      itemType !== 'channel_message' &&
      itemType !== 'channel_thread' &&
      itemType !== 'automation' &&
      itemType !== 'calendar_event' &&
      itemType !== 'foreign' &&
      // CRM companies/contacts aren't renamed via the FileList path (their
      // names derive from the directory/email, and their soup tags are
      // camelCase 'crmCompany'/'crmContact', not these snake-case itemTypes).
      itemType !== 'crm_company' &&
      itemType !== 'crm_contact'
    ) {
      txns.set(
        soupTransactionKey(itemType, id),
        optimisticUpdateSoupEntity({
          tag: itemType,
          data: { id, name: newName },
          frecency_score: score,
          touched_at: ownTouchStamp(id),
        })
      );
    }
  }
  return txns;
};

const renameChannelSetData = (entities: EntityRenameOptimisticInfo[]): void => {
  const channelUpdates = entities.filter(
    ({ itemType }) => itemType === 'channel'
  );
  if (channelUpdates.length === 0) return;

  queryClient.setQueryData<ApiChannelWithLatest[]>(
    channelKeys.listChannels.queryKey,
    (prev) => {
      if (!prev) return prev;
      return prev.map((channel) => {
        const update = channelUpdates.find(({ id }) => id === channel.id);
        if (!update) return channel;
        return { ...channel, name: update.newName };
      });
    }
  );
};

const renameCallRecordSetData = (
  entities: EntityRenameOptimisticInfo[]
): void => {
  entities.forEach(({ id, newName, itemType }) => {
    if (itemType !== 'call') return;
    queryClient.setQueryData<CallRecord>(
      callKeys.record(id).queryKey,
      (prev) => {
        if (!prev) return prev;
        return { ...prev, customName: newName };
      }
    );
  });
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
  entities: EntityRenameOptimisticInfo[]
): RenameRollbackContext {
  renamePreviewSetData(entities);
  renameHistorySetData(entities);
  renameChannelSetData(entities);
  renameCallRecordSetData(entities);
  const soupTransactions = renameDssSetData(entities);

  return { soupTransactions };
}

function rollbackOptimisticRenameUpdates({
  contexts,
  updates,
}: RenameOnMutateResult): void {
  for (const [, txn] of contexts.soupTransactions) {
    txn.rollback();
  }

  const rollbackEntities = updates.map(({ id, oldName, itemType }) => ({
    id,
    itemType,
    newName: oldName,
  }));

  renameHistorySetData(rollbackEntities);
  renamePreviewSetData(rollbackEntities);
  renameChannelSetData(rollbackEntities);
  renameCallRecordSetData(rollbackEntities);
}

const bulkRenameMutationFn = async (
  params: BulkRenameDssEntityMutationVariables
): Promise<BulkRenameDssEntityMutationData> => {
  validateBulkRename(params);

  if (!isFeatureEnabled(enableGraphqlSoup)) {
    return await Promise.all(params.map(performEntityRename));
  }

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
  params: BulkRenameDssEntityMutationVariables
): RenameOnMutateResult => {
  // TanStack runs onMutate before mutationFn. Validate before the first cache
  // write so an invalid batch cannot require a best-effort rollback.
  validateBulkRename(params);
  const updates = params
    .map(getEntityRenameData)
    .filter((d): d is EntityRenameData => d !== null);
  const contexts = performOptimisticRenameUpdates(updates);
  return { contexts, updates };
};

const bulkRenameOnSettled = (
  data: BulkRenameDssEntityMutationData | undefined,
  error: Error | null,
  params: BulkRenameDssEntityMutationVariables,
  onMutateResult: RenameOnMutateResult | undefined
): void => {
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
      const update = onMutateResult.updates[index];
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
        soupTransactions: failedSoupTransactions,
      },
      updates: failedUpdates,
    });
  }
};

/** supports channel/document/chat/project/call rename */
export function createRenameDssEntityMutation(
  callbacks?: MutationCallbacks<
    RenameDssEntityMutationData,
    Error,
    RenameDssEntityMutationVariables,
    RenameOnMutateResult
  >
) {
  return useMutation<
    RenameDssEntityMutationData,
    Error,
    RenameDssEntityMutationVariables,
    RenameOnMutateResult
  >(() => ({
    mutationFn: async (params) => (await bulkRenameMutationFn([params]))[0],
    ...withCallbacks<
      RenameDssEntityMutationData,
      Error,
      RenameDssEntityMutationVariables,
      RenameOnMutateResult
    >(
      {
        onMutate: async (params) => bulkRenameOnMutate([params]),
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

/** supports channel/document/chat/project/call bulk rename */
export function createBulkRenameDssEntityMutation() {
  return useMutation<
    BulkRenameDssEntityMutationData,
    Error,
    BulkRenameDssEntityMutationVariables,
    RenameOnMutateResult
  >(() => ({
    mutationFn: bulkRenameMutationFn,
    onMutate: bulkRenameOnMutate,
    onSettled: bulkRenameOnSettled,
  }));
}
