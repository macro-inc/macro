import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import { useShareDialogContext } from '@core/component/TopBar/ShareButton';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import ShareFat from '@icon/wide-share.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import { useGetFileBlob } from '../signal/blockData';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

export default function BlockUnknown() {
  return (
    <DocumentBlockContainer>
      <div class="size-full select-none overscroll-none overflow-hidden flex flex-col relative">
        <ModalsProvider>
          <SidePanel.Layout>
            <FileSidePanelSections />
            <div class="flex size-full min-w-0 flex-col overflow-hidden">
              <div class="relative">
                <TopBar />
              </div>
              <div class="w-full grow relative overflow-hidden">
                <Unknown />
              </div>
            </div>
          </SidePanel.Layout>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}

const Unknown = () => {
  const fileName = useBlockDocumentName();
  const downloadName = useBlockDocumentDownloadName();
  const shareCtx = useShareDialogContext();
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

  return (
    <div class="h-full flex flex-col justify-center items-center">
      <div class="w-fit mx-4 p-4 flex flex-col justify-center items-center gap-4">
        <div class="text-lg text-center">
          No preview available for{' '}
          <span class="text-ink-muted">{fileName()}</span>
        </div>

        <div class="flex flex-row gap-2 items-center">
          <Button variant="accent" onClick={shareCtx.open}>
            <ShareFat class="size-4" /> Share
          </Button>

          <Button variant="accent" onClick={downloadDocument}>
            <DownloadSimple class="size-4" /> Download
          </Button>
        </div>
      </div>
    </div>
  );
};
