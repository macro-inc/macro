import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { useBlockId } from '@core/block';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { createFileDownload } from '@core/util/createFileDownload';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import IconShared from '@icon/share.svg';
import Download from '@icon/system/regular/download.svg';
import { useGetFileBlob } from '../../signal/blockData';

/**
 * The video block's title menu operations, named header actions, and the
 * download that the menu and the header's Download control share.
 */
export function useVideoHeaderTools() {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();
  const getBlob = useGetFileBlob();

  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: blockId,
    blockAlias: 'video',
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));

  const download = createFileDownload(() => ({
    id: `${blockId}:${blockMetadataSignal()?.documentVersionId}`,
    name: downloadName(),
    load: (options) =>
      catchToResult(async () => ({ blob: await getBlob(options) })),
  }));
  const downloadDocument = () =>
    fireAndForget(download.start(), 'video-download');

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      group: 'file',
      label: 'Download',
      icon: Download,
      action: downloadDocument,
    },
    { op: 'delete' },
  ];

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: openShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { ops, download, openShare, actions: { share } };
}
