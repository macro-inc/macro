import { itemToSafeName } from '@core/constant/allBlocks';
import type { Item } from '@service-storage/generated/schemas/item';

type BaseHistoryItem = Pick<
  Item,
  'id' | 'name' | 'createdAt' | 'updatedAt' | 'deletedAt'
> & {
  viewedAt?: number;
};

export type DocumentHistoryItem = BaseHistoryItem &
  Pick<Extract<Item, { type: 'document' }>, 'type' | 'fileType' | 'subType'>;

export type ChatHistoryItem = BaseHistoryItem &
  Pick<Extract<Item, { type: 'chat' }>, 'type' | 'isPersistent'>;

export type ProjectHistoryItem = BaseHistoryItem &
  Pick<Extract<Item, { type: 'project' }>, 'type'>;

/** Minimal history item types containing only the properties actually used */
export type HistoryItem =
  | DocumentHistoryItem
  | ChatHistoryItem
  | ProjectHistoryItem;

export type HistoryQueryResponse = {
  data: HistoryItem[];
};

export function transformHistoryItem(
  item: HistoryItem,
  rawName?: boolean
): HistoryItem {
  const base = {
    id: item.id,
    name: rawName ? item.name : itemToSafeName(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
    viewedAt: item.viewedAt,
  };

  switch (item.type) {
    case 'document':
      return {
        ...base,
        type: 'document',
        fileType: item.fileType,
        subType: item.subType,
      };

    case 'chat':
      return {
        ...base,
        type: 'chat',
        isPersistent: item.isPersistent,
      };

    case 'project':
      return {
        ...base,
        type: 'project',
      };
  }
}

export function filterInstructionsMd(
  items: HistoryItem[],
  instructionsId: string | null | undefined
): HistoryItem[] {
  if (!instructionsId) return items;
  return items.filter((item) => item.id !== instructionsId);
}

export function transformHistoryResponse(
  data: HistoryQueryResponse,
  instructionsId: string | null | undefined,
  rawName?: boolean
): HistoryItem[] {
  return filterInstructionsMd(data.data, instructionsId).map((item) =>
    transformHistoryItem(item, rawName)
  );
}

/**
 * Pure function: Updates an item's viewedAt timestamp and moves it to the front.
 * Returns a new array without mutating the input.
 */
export function updateViewedAtAndMoveItemToFront(
  items: HistoryItem[],
  itemId: string,
  timestamp: number
): HistoryItem[] {
  const itemIndex = items.findIndex((item) => item.id === itemId);

  // Item not found, return original array
  if (itemIndex === -1) return items;

  const item = items[itemIndex];
  const updatedItem: HistoryItem = { ...item, viewedAt: timestamp };

  // Return new array with updated item at front
  return [
    updatedItem,
    ...items.slice(0, itemIndex),
    ...items.slice(itemIndex + 1),
  ];
}
