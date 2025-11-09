import { itemToSafeName } from '@core/constant/allBlocks';
import { isErr, isOk, ok } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { buildFileTree } from 'core/component/FileList/buildFileTree';
import { type Accessor, createMemo, createResource } from 'solid-js';
import { type ItemType, storageServiceClient } from './client';
import type { CloudStorageItemType } from './generated/schemas/cloudStorageItemType';
import type { Item } from './generated/schemas/item';
import { useInstructionsMdIdQuery } from './instructionsMd';
import { refetchResources } from './util/refetchResources';

const historyResource = createSingletonRoot(() => {
  return createResource(storageServiceClient.getUsersHistory, {
    initialValue: ok({ data: [] }),
  });
});

// this is a helper to filter out the instructions document from the history
const useFilteredHistory = createSingletonRoot(() => {
  const [resource] = historyResource();
  const instructionsMdIdQuery = useInstructionsMdIdQuery();

  return createMemo(() => {
    const result = resource();

    if (isOk(result)) {
      const [, history] = result;
      const data = history.data.filter(
        (item) => item.id !== instructionsMdIdQuery.data
      );
      return ok({ data });
    }

    return result;
  });
});

export const useHistoryTree = createSingletonRoot(() => {
  const history = useFilteredHistory();

  return createMemo(() => {
    const result = history();

    if (isOk(result)) {
      const items = result[1].data.map((item) => ({
        ...item,
        name: itemToSafeName(item),
      }));
      return buildFileTree(items);
    }

    return {
      rootItems: [],
      itemMap: {},
    };
  });
});

export const useHistory = createSingletonRoot(() => {
  const history = useFilteredHistory();

  return createMemo(() => {
    const result = history();

    if (isOk(result))
      return result[1].data.map((item) => {
        return {
          ...item,
          name: itemToSafeName(item),
        };
      });

    return [];
  });
});

export function useOptimisticMarkAsUpdated() {
  const [resource, { mutate }] = historyResource();
  const data = createMemo(() => {
    const result = resource.latest;
    if (!result) return [];
    const [, activity] = result;
    if (!activity) return [];
    return activity.data;
  });

  return (itemId: string) => {
    const now = Date.now() / 1000;
    mutate(
      ok({
        data: data().map((item) => {
          if (item.id === itemId) {
            return {
              ...item,
              updatedAt: now,
            };
          }
          return item;
        }),
      })
    );
  };
}

export const insertProjectIntoHistory = async (projectId: string) => {
  const [resource, { mutate }] = historyResource();
  const prevData = resource.latest[1]?.data ?? [];
  const newData: Item[] = [];
  const ids = [projectId];
  storageServiceClient.upsertItemToUserHistory({
    itemId: projectId,
    itemType: 'project',
  });

  while (ids.length > 0) {
    const id = ids.shift();
    if (!id) continue;

    const projectContent = await storageServiceClient.projects.getContent({
      id,
    });
    if (isOk(projectContent)) {
      ids.push(
        ...projectContent[1].data.reduce<string[]>((acc, { item }) => {
          if (
            item.type === 'project' &&
            !prevData.some(({ id }) => id === item.id)
          ) {
            acc.push(item.id);
          }
          return acc;
        }, [])
      );
      newData.push(...projectContent[1].data.map(({ item }) => item));
    }
  }
  mutate(
    ok({
      data: [...prevData, ...newData],
    })
  );
  const upsertResults = newData
    .filter((item) => !prevData.some(({ id }) => id === item.id))
    .map(({ id, type }) =>
      storageServiceClient.upsertItemToUserHistory({
        itemId: id,
        itemType: type,
      })
    );
  await Promise.all(upsertResults);
  refetchResources();
};

export async function refetchHistory(force = false) {
  const [resource, { refetch }] = historyResource();
  if (force) return refetch();
  if (resource.loading) return resource.latest;

  return refetch();
}

export async function removeHistoryItem(
  itemType: CloudStorageItemType,
  itemId: string
) {
  const [resource, { mutate, refetch }] = historyResource();
  const result = resource.latest;
  if (resource.error || isErr(result)) return false;

  mutate(
    ok({
      data: result[1].data.filter((item) => item.id !== itemId),
    })
  );
  const maybeRemoved = await storageServiceClient.removeItemFromUserHistory({
    itemId,
    itemType,
  });
  refetch();

  if (isOk(maybeRemoved) && maybeRemoved[1].success) return true;

  return false;
}

export async function optimisticUpdateParent(
  itemType: ItemType,
  itemId: string,
  parentId: string
) {
  const [resource, { mutate }] = historyResource();
  const result = resource.latest;
  if (resource.error || isErr(result)) return false;

  const currentHistory = result[1].data;

  // Create new history array with the item moved
  const newHistory = [...currentHistory].map((item) => {
    const currentId = item.id;
    if (currentId === itemId) {
      return {
        ...item,
      };
    }
    return item;
  });

  // Optimistically update the UI
  mutate(
    ok({
      data: newHistory,
    })
  );

  // And then check the Server

  let maybeUpdated;
  if (itemType === 'document') {
    maybeUpdated = await storageServiceClient.editDocument({
      documentId: itemId,
      projectId: parentId,
    });
  } else if (itemType === 'chat') {
    maybeUpdated = await cognitionApiServiceClient.editChatProject({
      chat_id: itemId,
      project_id: parentId,
    });
  } else {
    maybeUpdated = await storageServiceClient.projects.edit({
      id: itemId,
      projectParentId: parentId,
    });
  }

  refetchResources();
  if (isErr(maybeUpdated)) return false;
  return maybeUpdated[1]?.success;
}

export async function postNewHistoryItem(
  itemType: CloudStorageItemType,
  itemId: string
) {
  const [resource, { mutate }] = historyResource();

  const result = resource.latest;
  if (resource.error || isErr(result)) return false;

  const history = result[1].data;

  const recentItemIndex = history.findIndex((item) => item.id === itemId);

  if (recentItemIndex > 0) {
    mutate(
      ok({
        data: [
          ...history.slice(0, recentItemIndex),
          history[recentItemIndex],
          ...history.slice(recentItemIndex + 1),
        ],
      })
    );
  }

  const maybeAdded = await storageServiceClient.upsertItemToUserHistory({
    itemId,
    itemType,
  });

  await refetchHistory();

  if (isOk(maybeAdded) && maybeAdded[1].success) return true;

  return false;
}

export function useUpdatedDssItemName(itemId: string | Accessor<string>) {
  const [resource] = historyResource();

  return createMemo(() => {
    const maybeResult = resource.latest;
    if (isErr(maybeResult)) return;

    const itemIdValue = typeof itemId === 'function' ? itemId() : itemId;
    if (!itemIdValue) return;

    const dssItem = maybeResult[1].data.find((item) => item.id === itemIdValue);
    if (!dssItem) return;

    return dssItem.name;
  });
}
