import { itemToSafeName } from '@core/constant/allBlocks';
import type { Item } from '@service-storage/generated/schemas/item';
import type { HistoryItem, HistoryQueryResponse } from './types';

export function transformHistoryItem(item: Item): HistoryItem {
  const base = {
    id: item.id,
    name: itemToSafeName(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deletedAt: item.deletedAt,
    rawName: item.name,
  };

  switch (item.type) {
    case 'document':
      return {
        ...base,
        type: 'document',
        fileType: item.fileType,
        subType: item.subType,
        ownerId: item.owner,
      };

    case 'chat':
      return {
        ...base,
        type: 'chat',
        isPersistent: item.isPersistent,
        ownerId: item.userId,
      };

    case 'project':
      return {
        ...base,
        type: 'project',
        ownerId: item.userId,
      };
  }
}

export function transformHistoryResponse(
  response: HistoryQueryResponse
): HistoryItem[] {
  return response.data.map(transformHistoryItem);
}
