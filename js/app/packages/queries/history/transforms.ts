import { itemToSafeName } from '@core/constant/allBlocks';
import type { Item } from '@service-storage/generated/schemas/item';

type ItemWithViewedAt = Item & { viewedAt?: number };

export type HistoryItem = Item & {
  name: string;
  viewedAt?: number;
};

export type HistoryQueryResponse = {
  data: Item[];
};

export function transformHistoryItem(
  item: Item,
  rawName?: boolean
): HistoryItem {
  return {
    ...item,
    name: rawName ? item.name : itemToSafeName(item),
    viewedAt: (item as ItemWithViewedAt).viewedAt,
  };
}

export function filterInstructionsMd(
  items: Item[],
  instructionsId: string | null | undefined
): Item[] {
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
  items: ItemWithViewedAt[],
  itemId: string,
  timestamp: number
): ItemWithViewedAt[] {
  const itemIndex = items.findIndex((item) => item.id === itemId);

  // Item not found, return original array
  if (itemIndex === -1) return items;

  const item = items[itemIndex];
  const updatedItem: ItemWithViewedAt = { ...item, viewedAt: timestamp };

  // Return new array with updated item at front
  return [
    updatedItem,
    ...items.slice(0, itemIndex),
    ...items.slice(itemIndex + 1),
  ];
}
