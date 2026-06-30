import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/component/ChatWithAgentButton';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@app/component/ResponsiveBlockToolbar';
import { SidePanel, useSidePanel } from '@app/component/side-panel';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { FileOperation } from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { useHasModificationData } from '@block-pdf/signal/save';
import { useHasComments } from '@block-pdf/store/comments/commentStore';
import { doPrint } from '@block-pdf/util/printUtil';
import { exportPdf } from '@block-pdf/websocket/export';
import { useIsAuthenticated } from '@core/auth';
import { useBlockId, useBlockName } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import {
  REFERENCES_DRAWER_ID,
  ReferencesButton,
} from '@core/component/ReferencesModal';
import { openLoginModal } from '@core/component/TopBar/LoginButton';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import {
  ENABLE_PDF_MARKUP,
  ENABLE_REFERENCES_MODAL,
} from '@core/constant/featureFlags';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { blockMetadataSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/wide-share.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import Printer from '@phosphor/printer.svg';
import Quotes from '@phosphor/quotes.svg';
import SidePanelIcon from '@phosphor/square-half.svg';
import {
  blockNameToItemType,
  storageServiceClient,
} from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { Button, cn } from '@ui';
import { toast } from 'core/component/Toast/Toast';
import { platformFetch } from 'core/util/platformFetch';
import { onCleanup, Show } from 'solid-js';
import { pdfDocumentProxy } from '../signal/document';
import { LocationType, useCreateShareUrl } from '../signal/location';
import { MarkupToolbar } from './MarkupToolbar';
import { PageNumberInput } from './PageNumberInput';

export function TopBar() {
  const isAuth = useIsAuthenticated();
  const documentId = useBlockId();
  const blockName = useBlockName();
  const hasModificationData = useHasModificationData();
  const hasComments = useHasComments();
  const fileName = useBlockDocumentName('Unknown Filename');

  const referencesControl = useDrawerControl(REFERENCES_DRAWER_ID);
  const shareCtx = useShareDialogContext();
  const sidePanel = useSidePanel();
  const splitPanel = useSplitPanel();

  const createShareUrl = useCreateShareUrl();

  const itemType = blockNameToItemType(blockName);
  if (!itemType) return null;

  const fileType = blockMetadataSignal()?.fileType;

  const copyLink = () => {
    createShareUrl(LocationType.General);
    toast.success('Link copied to clipboard');
  };

  const printFile = createCallback(async () => {
    if (!isAuth()) return openLoginModal();

    const documentProxy = pdfDocumentProxy();
    if (!documentProxy) return;

    const data = (await documentProxy.getData()) as Uint8Array<ArrayBuffer>;
    const blob = new Blob([data], { type: 'application/pdf' });

    return doPrint(blob);
  });

  const download = createCallback(async () => {
    if (!isAuth()) return openLoginModal();

    const documentProxy = pdfDocumentProxy();
    if (!documentProxy) return toast.failure('Unable to download file');

    const data = (await documentProxy.getData()) as Uint8Array<ArrayBuffer>;
    const blob = new Blob([data], { type: 'application/pdf' });

    const fileNameWithExtension = `${fileName()}.pdf`;

    try {
      // No need to export if there are no modifications
      // comments are outside of the modification data so handled separately
      if (!hasModificationData() && hasComments() === false)
        return downloadFile(blob, fileNameWithExtension);

      // Attempt to export and download
      const exportFile = await exportPdf({
        documentId,
        fileName: fileName(),
      });
      downloadFile(exportFile, fileNameWithExtension);
    } catch (_) {
      try {
        downloadFile(blob, fileNameWithExtension);
      } catch (_) {
        toast.failure('Unable to download file');
      }
    }
  });

  const downloadDocx = createCallback(async () => {
    if (!isAuth()) return openLoginModal();

    const data = await storageServiceClient.exportDocument({ documentId });
    if (data.isErr()) {
      return toast.failure('Unable to download file');
    }

    const fileNameWithExtension = `${fileName()}.docx`;

    try {
      // Fetch the file from the presigned URL
      const response = await platformFetch(data.value.presigned_url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Get the file data as array buffer
      const arrayBuffer = await response.arrayBuffer();

      // Create blob with proper MIME type for DOCX
      const blob = new Blob([arrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      downloadFile(blob, fileNameWithExtension);

      toast.success('File downloaded successfully');
    } catch (error) {
      console.error('Download failed:', error);
      toast.failure('Failed to download file');
    }
  });

  if (splitPanel?.splitHotkeyScope) {
    const reg = registerHotkey({
      hotkey: ']',
      scopeId: splitPanel.splitHotkeyScope,
      hotkeyToken: TOKENS.block.toggleSidePanel,
      description: 'Toggle Side Panel',
      keyDownHandler: () => {
        if (!sidePanel) return false;
        if (!sidePanel.hasSections()) return false;
        sidePanel.toggle();
        return true;
      },
    });
    onCleanup(() => reg.dispose());
  }

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
      label: 'Download',
      icon: DownloadIcon,
      action: download,
    },
    ...(fileType === 'docx'
      ? [
          {
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
      label: 'References',
      icon: Quotes,
      action: referencesControl.toggle,
      condition: () => !!isAuth() && ENABLE_REFERENCES_MODAL,
      buttonComponent: () => (
        <ReferencesButton
          documentId={documentId}
          documentName={fileName()}
          buttonSize="sm"
        />
      ),
    },
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
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      buttonComponent: () => <ShareTrigger copyLink={copyLink} />,
      focusTarget: getShareDrawerRecipientInput,
    },
    {
      label: () =>
        sidePanel?.isOpen() ? 'Hide Side Panel' : 'Show Side Panel',
      icon: SidePanelIcon,
      action: () => sidePanel?.toggle(),
      isActive: () => sidePanel?.isOpen() ?? false,
      condition: () => !(sidePanel?.isNarrow() ?? isMobile()),
      buttonComponent: () => (
        <Show when={sidePanel}>
          {(panel) => (
            <Button
              depth={2}
              variant="base"
              size="icon-sm"
              class={cn('bg-surface order-20', {
                'bg-active': sidePanel?.isOpen(),
              })}
              tooltip={
                sidePanel?.isOpen() ? 'Hide Side Panel' : 'Show Side Panel'
              }
              hotkey={TOKENS.block.toggleSidePanel}
              onClick={() => {
                panel().toggle();
              }}
            >
              <SidePanelIcon />
            </Button>
          )}
        </Show>
      ),
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        {/* Hidden on mobile: no floating-island treatment for live avatars yet. */}
        <div class="-order-1 mobile:hidden">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>
      <ResponsivePermissionsBadge />
      <SplitToolbarLeft>
        <Show when={pdfDocumentProxy()}>
          <div class="flex items-center p-1">
            <Show when={!isMobile()}>
              <div class="w-5" />
            </Show>
            <PageNumberInput />
            <div class="w-5" />
            {ENABLE_PDF_MARKUP && <MarkupToolbar />}
          </div>
        </Show>
        <SidePanel.NarrowTabs />
      </SplitToolbarLeft>
      <ResponsiveBlockToolbar
        tools={tools}
        ops={ops}
        id={documentId}
        itemType={itemType}
        name={fileName()}
      />
    </>
  );
}
