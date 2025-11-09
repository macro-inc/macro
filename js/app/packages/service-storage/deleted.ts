import { buildFileTree } from '@core/component/FileList/buildFileTree';
import { itemToSafeName } from '@core/constant/allBlocks';
import { isErr, isOk, ok } from '@core/util/maybeResult';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource } from 'solid-js';
import { storageServiceClient } from './client';
import type { Item } from './generated/schemas/item';

const deletedResource = createSingletonRoot(() =>
  createResource(storageServiceClient.getDeletedItems, {
    initialValue: ok({ items: [] }),
  })
);

export async function refetchDeletedItems(force = false) {
  const [resource, { refetch }] = deletedResource();
  if (force) return refetch();
  if (resource.loading) return resource.latest;

  return refetch();
}

export const useDeletedItems = createSingletonRoot(() => {
  const [resource, { mutate }] = deletedResource();
  const deletedItems = createMemo(() => {
    const result = resource.latest;
    if (isOk(result)) {
      return result[1].items.map((item) => ({
        ...item,
        name: itemToSafeName(item),
      })) as Item[];
    }
  });

  return {
    deletedItems,
    mutate,
  };
});

export const useDeletedTree = createSingletonRoot(() => {
  const [resource] = deletedResource();
  return createMemo(() => {
    const result = resource.latest;

    if (isOk(result)) {
      const items = result[1].items.map((item) => ({
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

export async function optimisticallyRemoveDeletedItem(itemId: string) {
  const [resource, { mutate }] = deletedResource();
  const result = resource.latest;
  if (resource.error || isErr(result)) return false;

  // Optimistically remove the item
  mutate(
    ok({
      items: result[1].items.filter((item) => item.id !== itemId),
    })
  );
  return true;
}
