import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { useShareDialogContext } from '@core/component/TopBar/ShareButton';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import DownloadSimple from '@icon/regular/download-simple.svg';
import ShareFat from '@icon/regular/share-fat.svg';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import { useGetFileBlob } from '../signal/blockData';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';

export default function BlockUnknown() {
  return (
    <DocumentBlockContainer>
      <ModalsProvider>
        <div class="w-full h-full bg-panel select-none overscroll-none overflow-hidden flex flex-col relative">
          <div class="relative">
            <TopBar />
          </div>
          <div class="w-full grow-1 relative overflow-hidden">
            <Unknown />
          </div>
        </div>
      </ModalsProvider>
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
          <DeprecatedTextButton
            text="Share"
            theme="accent"
            icon={ShareFat}
            onClick={shareCtx.open}
          />

          <DeprecatedTextButton
            text="Download"
            theme="accent"
            icon={DownloadSimple}
            onClick={downloadDocument}
          />
        </div>
      </div>
    </div>
  );
};
