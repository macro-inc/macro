import { FileDownloadHeader } from '@components/app/FileDownloadHeader';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
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
import { useGetFileBlob } from '../signal/blockData';

export function TopBar() {
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

  const tools: BlockTool[] = [
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: openShare,
      buttonComponent: () => <ShareTrigger onClick={openShare} />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <FileDownloadHeader download={download} />
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>

      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="document"
        name={name()}
      />
    </>
  );
}
