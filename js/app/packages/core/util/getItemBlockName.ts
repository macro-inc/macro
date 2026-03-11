import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { Item } from '@service-storage/generated/schemas/item';

type NonDocumentItem = Pick<Exclude<Item, { type: 'document' }>, 'type'>;

type DocumentItem = Pick<
  Extract<Item, { type: 'document' }>,
  'type' | 'fileType' | 'subType'
>;

type ItemBlockNameInfo = NonDocumentItem | DocumentItem;

export function getItemBlockName(item: ItemBlockNameInfo, icon?: boolean) {
  if (item.type === 'document')
    return fileTypeToBlockName(
      (item.subType?.type as string | undefined) ?? item.fileType,
      icon
    );
  return item.type;
}
