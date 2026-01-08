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

export function transformHistoryItem(item: Item): HistoryItem {
  return {
    ...item,
    name: itemToSafeName(item),
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
  instructionsId: string | null | undefined
): HistoryItem[] {
  return filterInstructionsMd(data.data, instructionsId).map(
    transformHistoryItem
  );
}

export function updateItemViewedAt(
  items: Item[],
  itemId: string,
  timestamp: number
): Item[] {
  return items.map((item) =>
    item.id === itemId ? { ...item, viewedAt: timestamp } : item
  );
}
