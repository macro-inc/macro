import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';

import { useBlockId } from '@core/block';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { toast } from '@core/component/Toast/Toast';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { useGetFileBlob } from '../signal/blockData';

export function TopBar(props: { onShare: () => void }) {
  const blockId = useBlockId();
  const fileName = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();
  const getBlob = useGetFileBlob();

  const downloadDocument = createCallback(async () => {
    try {
      const blob = await getBlob();
      downloadFile(blob, downloadName());
    } catch (e) {
      console.error('error downloading file', e);
      toast.failure('Error downloading file');
    }
  });

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      group: 'file',
      label: 'Download',
      icon: DownloadSimple,
      action: downloadDocument,
    },
    { op: 'delete' },
  ];

  const tools: BlockTool[] = [
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: props.onShare,
      buttonComponent: () => <ShareTrigger onClick={props.onShare} />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel badges={<FileTypeChip />} />
      </SplitHeaderLeft>

      <ResponsivePermissionsBadge />

      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={blockId}
        itemType="document"
        name={fileName()}
      />
    </>
  );
}
