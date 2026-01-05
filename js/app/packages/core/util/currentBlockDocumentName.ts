import {
  createBlockMemo,
  isInBlock,
  NonDocumentBlockTypes,
  useBlockAliasedName,
} from '@core/block';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { blockMetadataSignal } from '@core/signal/load';
import { useUpdatedDssItemName } from '@service-storage/history';
import { formatDocumentName } from '@service-storage/util/filename';
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
  const blockName = useBlockAliasedName();
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

export const useBlockDocumentDownloadName = (defaultName?: string) => {
  const documentName = useBlockDocumentName(defaultName);

  return createMemo(() => {
    let current = documentName();
    if (!current) current = 'download';

    const fileType = blockMetadataSignal()?.fileType;
    return formatDocumentName(current, fileType);
  });
};
