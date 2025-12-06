import { itemToSafeName } from '@core/constant/allBlocks';
import { isErr, isOk, ok } from '@core/util/maybeResult';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource } from 'solid-js';
import { type ItemType, storageServiceClient } from './client';
import type { FileType } from './generated/schemas/fileType';
import type { Item } from './generated/schemas/item';
import { useHistory } from './history';

const pinsResource = createSingletonRoot(() =>
  createResource(() => storageServiceClient.getPins(), {
    initialValue: ok({ recent: [] }),
  })
);

export function usePins() {
  const [resource] = pinsResource();
  return createMemo(() => {
    const result = resource.latest;

    if (isOk(result))
      return result[1].recent.map((pinnedItem) => ({
        ...pinnedItem,
        item: {
          ...pinnedItem.item,
          name: itemToSafeName(pinnedItem.item),
        },
      }));

    return [];
  });
}

export function usePinnedIds() {
  const pins = usePins();
  return createMemo(() => pins().map(({ item }) => item.id), [], {
    equals: (a, b) => a.length === b.length && a.every((v) => b.includes(v)),
  });
}

export async function refetchPins(force = false) {
  const [resource, { refetch }] = pinsResource();
  if (force) return refetch();
  if (resource.loading) return resource.latest;

  return refetch();
}

export async function pinItem(pinType: ItemType, id: string, index?: number) {
  const [resource, { mutate, refetch }] = pinsResource();
  const result = resource.latest;
  if (resource.error || isErr(result)) return false;

  const pinnedItems = result[1].recent;
  const pinIndex = index ?? pinnedItems.length;

  const history = useHistory();
  const item = history().find((item) => item.id === id);

  if (item) {
    pinnedItems.push({ activity: item, item, pinIndex });
    mutate(
      ok({
        recent: pinnedItems,
      })
    );
  }

  const maybeAdded = await storageServiceClient.pinItem({
    id,
    pinType,
    pinIndex,
  });

  if (maybeAdded[1]?.success) {
    await storageServiceClient.reorderPins({
      pins: pinnedItems.map(({ item }, index) => ({
        pinIndex: index,
        pinnedItemType: item.type,
        pinnedItemId: item.id,
      })),
    });

    refetch();
    return true;
  }

  return false;
}

export async function unpinItem(pinType: ItemType, id: string) {
  const [resource, { mutate, refetch }] = pinsResource();
  const result = resource.latest;
  if (resource.error || isErr(result)) return false;

  const pinnedItems = result[1].recent;

  mutate(ok({ recent: pinnedItems.filter(({ item }) => item.id !== id) }));

  const maybeRemoved = await storageServiceClient.removePin({
    id,
    pinType,
  });
  refetch();

  return !!maybeRemoved[1]?.success;
}

type UnwrappedItemType = 'chat' | 'project' | 'rss' | FileType;

export function getUnwrappedType(item: Item): UnwrappedItemType {
  if (item.type === 'document') return item.fileType as FileType;
  return item.type;
}
