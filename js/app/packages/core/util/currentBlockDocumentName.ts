import {
  isInBlock,
  NonDocumentBlockTypes,
  useBlockAliasedName,
  useBlockId,
} from '@core/block';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { blockMetadataSignal } from '@core/signal/load';
import { useHistoryItemRawName } from '@queries/history/history';
import { formatDocumentName } from '@service-storage/util/filename';

export const useBlockDocumentName = (defaultName?: string) => {
  if (!isInBlock()) {
    throw new Error('hook must be used within a block');
  }
  // TODO: find new solution once block sigal is deprecated for good.
  const [metadata] = blockMetadataSignal;
  const blockId = useBlockId();
  const blockName = useBlockAliasedName();
  const isFileBlock = !NonDocumentBlockTypes.includes(blockName);

  const updatedName = useHistoryItemRawName(blockId);

  return () => {
    const current = updatedName();
    if (current) return current;
    const fromMeta = metadata()?.documentName;
    if (fromMeta) return fromMeta;
    if (defaultName !== undefined) return defaultName;
    if (isFileBlock) {
      return blockNameToDefaultFile(blockName);
    }
    return '';
  };
};

export const useBlockDocumentDownloadName = (defaultName?: string) => {
  const documentName = useBlockDocumentName(defaultName);

  return () => {
    let current = documentName();
    if (!current) current = 'download';
    const fileType = blockMetadataSignal()?.fileType;
    return formatDocumentName(current, fileType);
  };
};
