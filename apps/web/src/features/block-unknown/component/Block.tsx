import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import { createCallback } from '@solid-primitives/rootless';
import { lazy, Show, Suspense } from 'solid-js';
import { isUploadedWorkbook } from '../../block-spreadsheet/core/uploaded-workbook';
import { useSpreadsheetAccess } from '../../block-spreadsheet/primitives/use-spreadsheet-access';
import { useGetFileBlob } from '../signal/blockData';
import { TopBar } from './TopBar';
import { UnknownContent } from './UnknownContent';

const UploadedWorkbook = lazy(
  () => import('../../block-spreadsheet/views/UploadedWorkbook')
);

export default function BlockUnknown() {
  return (
    <DocumentBlockContainer>
      <div class="size-full select-none overscroll-none overflow-hidden flex flex-col relative">
        <BlockUnknownContent />
      </div>
    </DocumentBlockContainer>
  );
}

function BlockUnknownContent() {
  const enabled = useSpreadsheetAccess();
  const spreadsheet = () =>
    enabled() && isUploadedWorkbook(blockMetadataSignal.get()?.fileType);
  const fileName = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();
  const blockId = useBlockId();
  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: blockId,
    blockAlias: 'unknown',
    itemType: 'document',
    name: fileName() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));
  const getBlob = useGetFileBlob();

  const downloadDocument = createCallback(async () => {
    try {
      const blob = await getBlob();
      downloadFile(blob, downloadName());
    } catch (error) {
      console.error('error downloading file', error);
      toast.failure('Error downloading file');
    }
  });

  return (
    <SidePanel.Layout defaultOpen={!spreadsheet()}>
      <FileSidePanelSections />
      <div class="flex size-full min-w-0 flex-col overflow-hidden">
        <div class="relative">
          <TopBar onShare={openShare} />
        </div>
        <div class="w-full grow relative overflow-hidden">
          <Show
            when={spreadsheet()}
            fallback={
              <UnknownContent
                fileName={fileName()}
                onShare={openShare}
                onDownload={() => void downloadDocument()}
              />
            }
          >
            <Suspense
              fallback={
                <div class="p-6 text-ink-muted">Opening spreadsheet…</div>
              }
            >
              <UploadedWorkbook />
            </Suspense>
          </Show>
        </div>
      </div>
    </SidePanel.Layout>
  );
}
