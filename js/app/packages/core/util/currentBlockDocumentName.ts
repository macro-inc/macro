import {
  isInBlock,
  NonDocumentBlockTypes,
  useBlockAliasedName,
  useBlockId,
} from '@core/block';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { blockMetadataSignal } from '@core/signal/load';
import { useItemRawName } from '@queries/preview';
import { blockNameToItemType } from '@service-storage/client';
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

  const updatedName = useItemRawName(() => ({
    id: blockId,
    type: blockNameToItemType(blockName),
  }));

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
  const [metadata] = blockMetadataSignal;

  return () => {
    let current = documentName();
    if (!current) current = 'download';
    const fileType = metadata()?.fileType;
    return formatDocumentName(current, fileType, {
      caseInsensitiveSuffix: true,
    });
  };
};
