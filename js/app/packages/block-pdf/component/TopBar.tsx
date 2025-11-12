import EntityNavigationIndicator from '@app/component/EntityNavigationIndicator';
import {
  type FileOperation,
  SplitFileMenu,
} from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@app/component/split-layout/components/SplitLabel';
import {
  SplitToolbarLeft,
  SplitToolbarRight,
} from '@app/component/split-layout/components/SplitToolbar';
import { useHasModificationData } from '@block-pdf/signal/save';
import { useHasComments } from '@block-pdf/store/comments/commentStore';
import { doPrint } from '@block-pdf/util/printUtil';
import { exportPdf } from '@block-pdf/websocket/export';
import { useIsAuthenticated } from '@core/auth';
import { useBlockId } from '@core/block';
import { DocumentPropertiesModal } from '@core/component/DocumentPropertiesModal';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ReferencesModal } from '@core/component/ReferencesModal';
import { openLoginModal } from '@core/component/TopBar/LoginButton';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import {
  ENABLE_PDF_MARKUP,
  ENABLE_PROPERTIES_METADATA,
  ENABLE_REFERENCES_MODAL,
} from '@core/constant/featureFlags';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import DownloadIcon from '@icon/regular/download-simple.svg';
import Printer from '@icon/regular/printer.svg';
import { storageServiceClient } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import { platformFetch } from 'core/util/platformFetch';
import { Show } from 'solid-js';
import { pdfDocumentProxy } from '../signal/document';
import { LocationType, useCreateShareUrl } from '../signal/location';
import { MarkupToolbar } from './MarkupToolbar';
import { PageNumberInput } from './PageNumberInput';

export function TopBar() {
  const isAuth = useIsAuthenticated();
  const documentId = useBlockId();
  const hasModificationData = useHasModificationData();
  const hasComments = useHasComments();
  const fileName = useBlockDocumentName('Unknown Filename');
  const userPermissions = useGetPermissions();

  const fileType = blockMetadataSignal()?.fileType;

  const createShareUrl = useCreateShareUrl();
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

    try {
      // No need to export if there are no modifications
      // comments are outside of the modification data so handled separately
      if (!hasModificationData() && hasComments() === false)
        return downloadFile(blob, `${fileName()}.pdf`);

      // Attempt to export and download
      const exportFile = await exportPdf({
        documentId,
        fileName: fileName(),
      });
      downloadFile(exportFile, `${fileName()}.pdf`);
    } catch (_) {
      try {
        downloadFile(blob, `${fileName()}.pdf`);
      } catch (_) {
        toast.failure('Unable to download file');
      }
    }
  });

  const downloadDocx = createCallback(async () => {
    if (!isAuth()) return openLoginModal();

    const [_, data] = await storageServiceClient.exportDocument({ documentId });
    if (!data) {
      return toast.failure('Unable to download file');
    }

    try {
      // Fetch the file from the presigned URL
      const response = await platformFetch(data.presigned_url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Get the file data as array buffer
      const arrayBuffer = await response.arrayBuffer();

      // Create blob with proper MIME type for DOCX
      const blob = new Blob([arrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      // Use your existing downloadFile utility
      downloadFile(blob, `${fileName()}.docx`);

      toast.success('File downloaded successfully');
    } catch (error) {
      console.error('Download failed:', error);
      toast.failure('Failed to download file');
    }
  });

  const ops: FileOperation[] = [
    { op: 'pin' },
    { op: 'rename' },
    { op: 'copy' },
    { op: 'moveToProject' },
    {
      label: 'Print',
      icon: Printer,
      action: () => printFile(),
      divideAbove: true,
    },
    {
      label: 'Download',
      icon: DownloadIcon,
      action: download,
    },
    ...(fileType === 'docx'
      ? [
          {
            label: 'Download Docx',
            icon: DownloadIcon,
            action: downloadDocx,
          } as const,
        ]
      : []),
    { op: 'delete', divideAbove: true },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <div class="flex h-full">
          <EntityNavigationIndicator />
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>
      <SplitToolbarLeft>
        <Show when={pdfDocumentProxy()}>
          <div class="flex items-center p-1">
            <SplitFileMenu
              id={documentId}
              itemType="document"
              name={fileName()}
              ops={ops}
            />
            <div class="w-5" />
            <PageNumberInput />
            <div class="w-5" />
            {ENABLE_PDF_MARKUP && <MarkupToolbar />}
          </div>
        </Show>
      </SplitToolbarLeft>
      <SplitToolbarRight>
        <div class="flex items-center p-1">
          <Show when={ENABLE_REFERENCES_MODAL}>
            <ReferencesModal
              documentId={documentId}
              documentName={fileName()}
              buttonSize="sm"
            />
          </Show>
          <Show when={ENABLE_PROPERTIES_METADATA}>
            <DocumentPropertiesModal
              documentId={documentId}
              blockType="pdf"
              buttonSize="sm"
            />
          </Show>
          <div class="flex items-center">
            <SplitPermissionsBadge />
            <ShareButton
              id={documentId}
              name={fileName()}
              userPermissions={userPermissions()}
              copyLink={copyLink}
              itemType="document"
              owner={blockMetadataSignal()?.owner}
            />
          </div>
        </div>
      </SplitToolbarRight>
    </>
  );
}
