import { renameItem } from '@core/component/FileList/itemOperations';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { setHistoryItemName } from '@queries/history/history';
import { setPreviewName } from '@queries/preview';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
  type SoupTransaction,
} from '@queries/soup/cache';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { ChannelTypeEnum } from '@service-comms/client';
import type { ApiChannelWithLatest } from '@service-comms/generated/models';
import type { ItemType } from '@service-storage/client';
import { useMutation } from '@tanstack/solid-query';

type RenamableEntity = Pick<EntityData, 'id' | 'type' | 'name'> &
  Partial<EntityData>;

type EntityRenameOperation = {
  entity: RenamableEntity;
  newName: string;
};

type EntityRenameOperationResult = {
  success: boolean;
};

// Keyed by entity ID so rollback indices stay aligned even when flatMap filters out types
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

type RenameOnMutateResult = {
  contexts: RenameRollbackContext;
  updates: EntityRenameData[];
};

const getEntityRenameData = (
  operation: EntityRenameOperation
): EntityRenameData | null => {
  const { entity, newName } = operation;
  if (entity.type === 'call') return null;
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

const validateEntityRename = (entity: EntityData): void => {
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
      return;
    default:
      throw new Error(`Unsupported entity type: ${entity.type}`);
  }
};

const renameDssSetData = (
  entities: EntityRenameOptimisticInfo[]
): SoupTransactionMap => {
  const txns: SoupTransactionMap = new Map();
  for (const { id, itemType, newName } of entities) {
    const current = getSoupEntityById(id);
    const score = current?.frecency_score ?? 0;
    if (itemType === 'channel') {
      txns.set(
        id,
        optimisticUpdateSoupEntity({
          tag: 'channel',
          data: { channel: { id, name: newName } },
          frecency_score: score,
        })
      );
    } else if (itemType !== 'email' && itemType !== 'channel_message') {
      txns.set(
        id,
        optimisticUpdateSoupEntity({
          tag: itemType,
          data: { id, name: newName },
          frecency_score: score,
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

const renamePreviewSetData = (entities: EntityRenameOptimisticInfo[]) => {
  entities.forEach(({ id, newName, itemType }) => {
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
}

const bulkRenameMutationFn = async (
  params: BulkRenameDssEntityMutationVariables
): Promise<BulkRenameDssEntityMutationData> => {
  const entities = params.map((p) => p.entity);
  entities.forEach(validateEntityRename);

  // TODO: add bulk rename on backend or consider batching in chunks
  // with timeouts to avoid too many requests
  return await Promise.all(params.map(performEntityRename));
};

const bulkRenameOnMutate = (
  params: BulkRenameDssEntityMutationVariables
): RenameOnMutateResult => {
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
        const txn = onMutateResult.contexts.soupTransactions.get(update.id);
        if (txn) failedSoupTransactions.set(update.id, txn);
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

/** supports channel/document/chat/project rename */
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

/** supports channel/document/chat/project bulk rename */
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
