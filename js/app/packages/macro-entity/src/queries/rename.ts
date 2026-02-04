import { renameItem } from '@core/component/FileList/itemOperations';
import {
  optimisticUpdateChannelName,
  rollbackUpdateChannelName,
  type UpdateChannelNameContext,
} from '@queries/channel/channel';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { ItemType } from '@service-storage/client';
import type { EntityData } from '../types/entity';
import { queryClient } from './client';
import { queryKeys } from './key';
import { useMutation } from '@tanstack/solid-query';
import { toast } from '@core/component/Toast/Toast';

type EntityWithName = EntityData & { name: string };

type EntityRenameOperation = {
  entity: EntityWithName;
  newName: string;
};

type EntityRenameOperationResult = {
  success: boolean;
};

/** Map of channel ID to its update context */
type ChannelRenameContexts = Map<string, UpdateChannelNameContext | undefined>;

type EntityRenameData = {
  id: string;
  itemType: ItemType;
  newName: string;
};

type EntityIdToNameMap = Map<string, string>;

type RenameDssEntityMutationVariables = EntityRenameOperation;

type BulkRenameDssEntityMutationVariables = RenameDssEntityMutationVariables[];

type RenameDssEntityMutationData = EntityRenameOperationResult;

type BulkRenameDssEntityMutationData = RenameDssEntityMutationData[];

type RenameOnMutateResult = {
  contexts: ChannelRenameContexts;
  updates: EntityRenameData[];
};

const getEntityRenameData = (
  operation: EntityRenameOperation
): EntityRenameData => {
  const { entity, newName } = operation;
  return {
    id: entity.id,
    itemType: entity.type,
    newName,
  };
};

const performEntityRename = async (operation: EntityRenameOperation) => {
  const data = getEntityRenameData(operation);
  const success = await renameItem(data);
  return { success };
};

const isEntityRenameSupported = (entity: EntityData) => {
  switch (entity.type) {
    case 'channel':
      return entity.channelType !== 'direct_message';
    case 'document':
    case 'chat':
    case 'project':
      return true;
    default:
      return false;
  }
};

/**
 * Helper to update entity names in DSS query data
 */
function updateEntityNamesInQueryData(
  prev: { pages: { items: EntityData[] }[] } | undefined,
  updates: EntityIdToNameMap
) {
  if (!prev) return prev;
  const pages = prev.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      const newName = updates.get(item.id);
      return newName ? { ...item, name: newName } : item;
    }),
  }));
  return {
    ...prev,
    pages,
  };
}

/**
 * Helper to perform optimistic rename updates for entities
 */
function performOptimisticRenameUpdates(
  entities: EntityRenameData[]
): ChannelRenameContexts {
  const updates: EntityIdToNameMap = new Map(
    entities.map((e) => [e.id, e.newName])
  );
  const contexts: ChannelRenameContexts = new Map();

  queryClient.cancelQueries({
    queryKey: queryKeys.dss({ infinite: true }),
  });

  queryClient.setQueriesData(
    { queryKey: queryKeys.dss({ infinite: true }) },
    (prev: { pages: { items: EntityData[] }[] } | undefined) =>
      updateEntityNamesInQueryData(prev, updates)
  );

  // Handle channel-specific optimistic updates
  entities.forEach(({ id, itemType, newName }) => {
    if (itemType === 'channel') {
      const context = optimisticUpdateChannelName({
        channelId: id,
        name: newName,
      });
      if (context) {
        contexts.set(id, context);
      }
    }
  });

  return contexts;
}

/**
 * Helper to rollback optimistic rename updates on error
 */
function rollbackOptimisticRenameUpdates({
  contexts,
  updates,
}: RenameOnMutateResult): void {
  if (!contexts) return;
  updates.forEach(({ id, itemType }) => {
    if (itemType === 'channel') {
      const context = contexts.get(id);
      if (context) {
        rollbackUpdateChannelName(id, context);
      } else {
        console.error(`No rollback context provided for channel item ${id}`);
      }
    }
  });
}

const bulkRenameMutationFn = async (
  params: BulkRenameDssEntityMutationVariables
): Promise<BulkRenameDssEntityMutationData> => {
  const entities = params.map((p) => p.entity);
  if (!entities.every(isEntityRenameSupported)) {
    throw new Error(`Unsupported entity type provided`);
  }

  return await Promise.all(params.map(performEntityRename));
};

const bulkRenameOnMutate = (
  params: BulkRenameDssEntityMutationVariables
): RenameOnMutateResult => {
  const updates = params.map(getEntityRenameData);
  const contexts = performOptimisticRenameUpdates(updates);
  return { contexts, updates };
};

const bulkRenameOnSettled = (
  data: BulkRenameDssEntityMutationData | undefined,
  error: Error | null,
  params: BulkRenameDssEntityMutationVariables,
  onMutateResult: RenameOnMutateResult | undefined
): void => {
  if (error) {
    console.error(`Failed bulk rename`, params, data, error);
    toast.failure('Failed to rename items');

    if (onMutateResult) {
      rollbackOptimisticRenameUpdates(onMutateResult);
    }
  }

  // TODO: refetch channel id/list query

  queryClient.invalidateQueries({
    queryKey: queryKeys.all.dss,
  });
};

/**
 * Mutation to rename a DSS entity.
 */
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
        onSettled: (data, error, params, onMutateResult) =>
          bulkRenameOnSettled(
            data ? [data] : undefined,
            error,
            [params],
            onMutateResult
          ),
      },
      callbacks
    ),
  }));
}

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
