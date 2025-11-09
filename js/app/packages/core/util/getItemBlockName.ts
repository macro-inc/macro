import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { Item } from '@service-storage/generated/schemas/item';

export function getItemBlockName(item: Item, icon?: boolean) {
  if (item.type === 'document') return fileTypeToBlockName(item.fileType, icon);
  return item.type;
}
