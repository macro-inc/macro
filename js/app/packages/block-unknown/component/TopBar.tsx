import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@app/component/split-layout/components/SplitLabel';

import { useIsAuthenticated } from '@core/auth';
import { useBlockId } from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import {
  ReferencesButton,
  REFERENCES_DRAWER_ID,
} from '@core/component/ReferencesModal';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_REFERENCES_MODAL } from '@core/constant/featureFlags';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import DownloadSimple from '@icon/regular/download-simple.svg';
import Quotes from '@icon/regular/quotes.svg';
import IconShared from '@macro-icons/wide/share.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Show } from 'solid-js';
import { toast } from 'core/component/Toast/Toast';
import { useGetFileBlob } from '../signal/blockData';

function FileTypeChip() {
  const fileType = () => blockMetadataSignal()?.fileType;
  return (
    <Show when={fileType()}>
      <span class="shrink-0 rounded px-1 py-0.5 text-[0.625rem] font-mono font-medium uppercase leading-none bg-surface-secondary text-ink-muted">
        {fileType()}
      </span>
    </Show>
  );
}

export function TopBar() {
  const isAuth = useIsAuthenticated();
  const blockId = useBlockId();
  const fileName = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();
  const getBlob = useGetFileBlob();

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const shareCtx = useShareDialogContext();

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
      label: 'Download',
      icon: DownloadSimple,
      action: downloadDocument,
      divideAbove: true,
    },
    { op: 'delete', divideAbove: true },
  ];

  const tools: BlockTool[] = [
    {
      label: 'References',
      icon: Quotes,
      action: referencesControl.toggle,
      condition: () => !!isAuth() && ENABLE_REFERENCES_MODAL,
      buttonComponent: () => (
        <ReferencesButton
          documentId={blockId}
          documentName={fileName()}
          buttonSize="sm"
        />
      ),
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      divideAbove: true,
      buttonComponent: () => <ShareTrigger />,
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
