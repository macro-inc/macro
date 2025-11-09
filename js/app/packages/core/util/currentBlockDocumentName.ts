import {
  createBlockMemo,
  isInBlock,
  NonDocumentBlockTypes,
  useBlockName,
} from '@core/block';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { blockMetadataSignal } from '@core/signal/load';
import { useUpdatedDssItemName } from '@service-storage/history';
import { createMemo } from 'solid-js';

const currentBlockDocumentName = createBlockMemo(() => {
  const documentMetadata = blockMetadataSignal();
  if (!documentMetadata) return;
  const { documentId, documentName } = documentMetadata;
  const dssFileName = useUpdatedDssItemName(documentId);
  const changedName = dssFileName();
  return changedName ?? documentName;
});

export const useBlockDocumentName = (defaultName?: string) => {
  if (!isInBlock()) {
    throw new Error('hook must be used within a block');
  }
  const blockName = useBlockName();
  const isFileBlock = !NonDocumentBlockTypes.includes(blockName);

  return createMemo(() => {
    const current = currentBlockDocumentName();
    if (current) return current;
    if (defaultName !== undefined) return defaultName;
    if (isFileBlock) {
      return blockNameToDefaultFile(blockName);
    }
    return '';
  });
};
