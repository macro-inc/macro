import { itemToSafeName } from '@core/constant/allBlocks';
import { parseDate } from '@core/util/date';
import type { Item } from '@service-storage/generated/schemas/item';
import type { HistoryItem, HistoryQueryResponse } from './types';

export function transformHistoryItem(item: Item): HistoryItem {
  const base = {
    id: item.id,
    name: itemToSafeName(item),
    createdAt: parseDate(item.createdAt),
    updatedAt: parseDate(item.updatedAt),
    deletedAt: parseDate(item.deletedAt),
    rawName: item.name,
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

export function transformHistoryResponse(
  response: HistoryQueryResponse
): HistoryItem[] {
  return response.data.map(transformHistoryItem);
}

/**
 * Pure function: Updates an item's viewedAt timestamp and moves it to the front.
 * Returns a new array without mutating the input.
 */
export function updateViewedAtAndMoveItemToFront(
  items: HistoryItem[],
  itemId: string,
  timestamp: Date
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
