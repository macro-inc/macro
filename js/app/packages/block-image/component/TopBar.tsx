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
import { DETAILS_DRAWER_ID } from '@core/component/DetailsDrawer';
import { FileTypeChip } from '@core/component/FileTypeChip';
import {
  ReferencesButton,
  REFERENCES_DRAWER_ID,
} from '@core/component/ReferencesModal';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_REFERENCES_MODAL } from '@core/constant/featureFlags';
import { blockFileSignal } from '@core/signal/load';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import Download from '@icon/regular/download.svg';
import Info from '@icon/regular/info.svg';
import Quotes from '@icon/regular/quotes.svg';
import IconShared from '@macro-icons/wide/share.svg';
import { createCallback } from '@solid-primitives/rootless';

export function TopBar() {
  const isAuth = useIsAuthenticated();
  const blockId = useBlockId();
  const imageFile = blockFileSignal.get;
  const name = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const detailsControl = useDrawerControl(DETAILS_DRAWER_ID);
  const shareCtx = useShareDialogContext();

  const downloadDocument = createCallback(async () => {
    const file = imageFile();
    if (!file) return;
    downloadFile(file, downloadName());
  });

  const ops: FileOperation[] = [
    {
      label: 'Details',
      icon: Info,
      action: detailsControl.toggle,
    },
    { op: 'rename', divideAbove: true },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      label: 'Download',
      icon: Download,
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
          documentName={name()}
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
        name={name()}
      />
    </>
  );
}
