import {
  isInBlock,
  NonDocumentBlockTypes,
  useBlockAliasedName,
  useBlockId,
} from '@core/block';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { blockMetadataSignal } from '@core/signal/load';
import { useUpdatedDssItemName } from '@queries/history/history';
import { formatDocumentName } from '@service-storage/util/filename';
import { createMemo } from 'solid-js';

export const useBlockDocumentName = (defaultName?: string) => {
  if (!isInBlock()) {
    throw new Error('hook must be used within a block');
  }
  const blockName = useBlockAliasedName();
  const isFileBlock = !NonDocumentBlockTypes.includes(blockName);

  const updatedName = useUpdatedDssItemName(useBlockId());

  return createMemo(() => {
    const current = updatedName();
    if (current) return current;
    if (defaultName !== undefined) return defaultName;
    if (isFileBlock) {
      return blockNameToDefaultFile(blockName);
    }
    return '';
  });
};

export const useBlockDocumentDownloadName = (defaultName?: string) => {
  const documentName = useBlockDocumentName(defaultName);

  return createMemo(() => {
    let current = documentName();
    if (!current) current = 'download';

    const fileType = blockMetadataSignal()?.fileType;
    return formatDocumentName(current, fileType);
  });
};
