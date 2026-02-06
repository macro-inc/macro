import { renameItem } from '@core/component/FileList/itemOperations';
import {
  optimisticUpdateChannelName,
  rollbackUpdateChannelName,
  type UpdateChannelNameContext,
} from '@queries/channel/channel';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { ItemType } from '@service-storage/client';
import { ChannelTypeEnum } from '@service-comms/client';
import type { EntityData } from '../types/entity';
import { queryClient } from './client';
import { queryKeys } from './key';
import { type InfiniteData, useMutation } from '@tanstack/solid-query';
import { toast } from '@core/component/Toast/Toast';
import type { SoupPage } from '@service-storage/generated/schemas';
import { setPreviewName } from '@queries/preview';
import { setHistoryItemName } from '@queries/history/history';
import { createCognitionWebsocketEffect } from '@service-cognition/websocket';

type RenamableEntity = Pick<EntityData, 'id' | 'type' | 'name'> &
  Partial<EntityData>;

type EntityRenameOperation = {
  entity: RenamableEntity;
  newName: string;
};

type EntityRenameOperationResult = {
  success: boolean;
};

// Maps channel ID to its update context, which lets us rollback the updated at timestamp as well as name
type ChannelRenameContexts = Map<string, UpdateChannelNameContext | undefined>;

type RenameRollbackContext = {
  channels: ChannelRenameContexts;
};

type EntityRenameData = {
  id: string;
  itemType: ItemType;
  oldName: string;
  newName: string;
};

type EntityRenameOptimisticInfo = Omit<EntityRenameData, 'oldName'>;

type EntityIdToNameMap = Map<string, string>;

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
): EntityRenameData => {
  const { entity, newName } = operation;
  return {
    id: entity.id,
    itemType: entity.type,
    oldName: entity.name,
    newName,
  };
};

const performEntityRename = async (operation: EntityRenameOperation) => {
  const data = getEntityRenameData(operation);
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

// TODO: move item to front of list with updatedAt timestamp
function updateEntityNamesInDssQueryData(
  prev: InfiniteData<SoupPage, unknown> | undefined,
  updates: EntityIdToNameMap
): InfiniteData<SoupPage, unknown> | undefined {
  if (!prev) return prev;
  const pages = prev.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => {
      // NOTE: reactivity does not seem to be a problem here so no spread is needed?
      switch (item.tag) {
        case 'channel': {
          const itemId = item.data.channel.id;
          const newName = updates.get(itemId);
          if (newName === undefined) return item;
          item.data.channel.name = newName;
          break;
        }
        case 'document':
        case 'chat':
        case 'project': {
          const itemId = item.data.id;
          const newName = updates.get(itemId);
          if (newName === undefined) return item;
          item.data.name = newName;
          break;
        }
        default:
          break;
      }
      return item;
    }),
  }));
  return {
    ...prev,
    pages,
  };
}

const renameDssSetData = (entities: EntityRenameOptimisticInfo[]) => {
  const updates: EntityIdToNameMap = new Map(
    entities.map((e) => [e.id, e.newName])
  );

  queryClient.cancelQueries({
    queryKey: queryKeys.all.dss,
  });
  queryClient.setQueriesData({ queryKey: queryKeys.all.dss }, (prev) =>
    updateEntityNamesInDssQueryData(
      prev as InfiniteData<SoupPage, unknown> | undefined,
      updates
    )
  );
};

const renameChannelSetData = (
  entities: EntityRenameOptimisticInfo[]
): ChannelRenameContexts => {
  const contexts: ChannelRenameContexts = new Map();

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
  renameDssSetData(entities);
  const channelContexts = renameChannelSetData(entities);

  return {
    channels: channelContexts,
  };
}

function rollbackOptimisticRenameUpdates({
  contexts,
  updates,
}: RenameOnMutateResult): void {
  updates.forEach(({ id, oldName, itemType }) => {
    const reverseUpdate = { id, itemType, newName: oldName, oldName };
    renameDssSetData([reverseUpdate]);
    renameHistorySetData([reverseUpdate]);
    renamePreviewSetData([reverseUpdate]);

    if (itemType === 'channel') {
      const context = contexts.channels.get(id);
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
  entities.forEach(validateEntityRename);

  // TODO: add bulk rename on backend or consider batching in chunks
  // with timeouts to avoid too many requests
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

  // Rollback only the failed items by matching indices
  const failedUpdates: EntityRenameData[] = [];
  const failedChannelContexts: ChannelRenameContexts = new Map();

  data.forEach((result, index) => {
    if (!result.success) {
      const update = onMutateResult.updates[index];
      if (update) {
        failedUpdates.push(update);
        // Preserve channel context for failed channels
        if (update.itemType === 'channel') {
          const context = onMutateResult.contexts.channels.get(update.id);
          if (context !== undefined) {
            failedChannelContexts.set(update.id, context);
          }
        }
      }
    }
  });

  // Rollback only the failed items
  if (failedUpdates.length > 0) {
    rollbackOptimisticRenameUpdates({
      contexts: { channels: failedChannelContexts },
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

const CHAT_RENAME_TIMEOUT_MS = 20000;

/**
 * Waits for a chat rename to complete and updates the query cache(s).
 * If noDispose is true, the effect will not be disposed after completion/timeout.
 * Returns a dispose function to cancel the wait.
 */
export function useWaitChatRename(chatId: string, noDispose?: boolean) {
  if (!noDispose) {
    setTimeout(() => {
      dispose();
    }, CHAT_RENAME_TIMEOUT_MS);
  }

  const dispose = createCognitionWebsocketEffect('chat_renamed', (data) => {
    if (data.chat_id !== chatId) return;
    performOptimisticRenameUpdates([
      { id: chatId, newName: data.name, itemType: 'chat' },
    ]);
    if (!noDispose) {
      dispose();
    }
  });

  return dispose;
}
