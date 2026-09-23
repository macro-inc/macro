import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import { useHasModificationData } from '@block-pdf/signal/save';
import { useHasComments } from '@block-pdf/store/comments/commentStore';
import {
  downloadDocxDocument,
  downloadPdfDocument,
  printPdfDocument,
} from '@block-pdf/util/pdf-file-actions';
import type { BlockTool } from '@components/app/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useIsAuthenticated } from '@core/auth';
import { useBlockId, useBlockName } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { toast } from '@core/component/Toast/Toast';
import { openLoginModal } from '@core/component/TopBar/LoginButton';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { blockMetadataSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import DownloadIcon from '@phosphor/download-simple.svg';
import Printer from '@phosphor/printer.svg';
import IconShared from '@phosphor/share.svg';
import { blockNameToItemType } from '@service-storage/itemType';
import { createCallback } from '@solid-primitives/rootless';
import { usePdfDocument } from '../context/pdf-document-context';
import { LocationType, useCreateShareUrl } from '../signal/location';
import { PdfSplitToolbar } from './PdfSplitToolbar';

export function TopBar() {
  const pdf = usePdfDocument();
  const documentProxy = pdf.documentProxy;
  const isAuth = useIsAuthenticated();
  const documentId = useBlockId();
  const blockName = useBlockName();
  const hasModificationData = useHasModificationData();
  const hasComments = useHasComments();
  const fileName = useBlockDocumentName('Unknown Filename');

  const shareCtx = useShareDialogContext();

  const createShareUrl = useCreateShareUrl();

  const itemType = blockNameToItemType(blockName);
  if (!itemType) return null;

  const fileType = blockMetadataSignal()?.fileType;

  const copyLink = () => {
    createShareUrl(LocationType.General);
    toast.success('Link copied to clipboard');
  };

  const fileActionAuth = () => ({
    isAuthenticated: !!isAuth(),
    openLogin: openLoginModal,
  });

  const printFile = createCallback(() =>
    printPdfDocument({
      ...fileActionAuth(),
      documentProxy: documentProxy(),
    })
  );

  const download = createCallback(() =>
    downloadPdfDocument({
      ...fileActionAuth(),
      documentProxy: documentProxy(),
      hasModifications: hasModificationData(),
      hasComments: hasComments(),
      documentId,
      fileName: fileName(),
    })
  );

  const downloadDocx = createCallback(() =>
    downloadDocxDocument({
      ...fileActionAuth(),
      documentId,
      fileName: fileName(),
    })
  );

  const ops: FileOperation[] = [
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      label: 'Print',
      icon: Printer,
      action: () => printFile(),
    },
    {
      group: 'file',
      label: 'Download',
      icon: DownloadIcon,
      action: download,
    },
    ...(fileType === 'docx'
      ? [
          {
            group: 'file',
            label: 'Download DOCX',
            icon: DownloadIcon,
            action: downloadDocx,
          } as const,
        ]
      : []),
    { op: 'delete' },
  ];

  const tools: BlockTool[] = [
    {
      label: 'Chat',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: documentId,
          name: fileName(),
          fileType,
        }),
      buttonComponent: () => (
        <ChatWithAgentButton
          entity={{
            type: 'document',
            id: documentId,
            name: fileName(),
            fileType,
          }}
        />
      ),
    },
    {
      group: 'sharing',
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      buttonComponent: () => <ShareTrigger copyLink={copyLink} />,
      focusTarget: getShareDrawerRecipientInput,
    },
  ];

  const menuTools: BlockTool[] = [
    {
      label: 'Ask Macro',
      icon: ChatWithAgentIcon,
      action: () =>
        openChatWithAgent({
          type: 'document',
          id: documentId,
          name: fileName(),
          fileType,
        }),
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        {/* Hidden on mobile/tablet: no floating-island treatment for live avatars yet. */}
        <div class="-order-1 touch:hidden">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>
      <PdfSplitToolbar />
      <ResponsivePermissionsBadge />
      <ResponsiveBlockToolbar
        tools={tools}
        menuTools={menuTools}
        ops={ops}
        id={documentId}
        itemType={itemType}
        name={fileName()}
      />
    </>
  );
}
