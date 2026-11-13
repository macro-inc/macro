import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { toast } from '@core/component/Toast/Toast';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentDownloadName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { useGetFileBlob } from '../../signal/blockData';

/** The unknown file block's title menu operations and named header actions. */
export function useUnknownHeaderTools(onShare: () => void) {
  const downloadName = useBlockDocumentDownloadName();
  const getBlob = useGetFileBlob();

  const downloadDocument = createCallback(async () => {
    try {
      const blob = await getBlob();
      await downloadFile(blob, downloadName());
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

  const share: BlockTool = {
    group: 'sharing',
    label: 'Share',
    icon: IconShared,
    action: onShare,
    focusTarget: getShareDrawerRecipientInput,
  };

  return { ops, actions: { share } };
}
