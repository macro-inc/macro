import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import { useShareDialogContext } from '@core/component/TopBar/ShareButton';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import { createCallback } from '@solid-primitives/rootless';
import { useGetFileBlob } from '../signal/blockData';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';
import { UnknownContent } from './UnknownContent';

export default function BlockUnknown() {
  return (
    <DocumentBlockContainer>
      <div class="size-full select-none overscroll-none overflow-hidden flex flex-col relative">
        <ModalsProvider>
          <BlockUnknownContent />
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}

function BlockUnknownContent() {
  const fileName = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();
  const shareCtx = useShareDialogContext();
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
    <SidePanel.Layout>
      <FileSidePanelSections />
      <div class="flex size-full min-w-0 flex-col overflow-hidden">
        <div class="relative">
          <TopBar />
        </div>
        <div class="w-full grow relative overflow-hidden">
          <UnknownContent
            fileName={fileName()}
            onShare={shareCtx.open}
            onDownload={() => void downloadDocument()}
          />
        </div>
      </div>
    </SidePanel.Layout>
  );
}
