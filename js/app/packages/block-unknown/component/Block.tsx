import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { getPermissions, Permissions } from '@core/component/SharePermissions';
import { TextButton } from '@core/component/TextButton';
import { ShareModal } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import DownloadSimple from '@icon/regular/download-simple.svg';
import ShareFat from '@icon/regular/share-fat.svg';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import { createSignal } from 'solid-js';
import { blockData, useGetFileBlob } from '../signal/blockData';
import { TopBar } from './TopBar';

export default function BlockUnknown() {
  return (
    <DocumentBlockContainer>
      <div class="w-full h-full bg-panel select-none overscroll-none overflow-hidden flex flex-col relative">
        <div class="relative">
          <TopBar />
        </div>
        <div class="w-full grow-1 relative overflow-hidden">
          <Unknown />
        </div>
      </div>
    </DocumentBlockContainer>
  );
}

const Unknown = () => {
  const documentId = useBlockId();
  const fileName = useBlockDocumentName();
  const [isSharePermOpen, setIsSharePermOpen] = createSignal(false);
  const getBlob = useGetFileBlob();

  const userPermissions = () => {
    const accessLevel = blockData()?.userAccessLevel;
    if (!accessLevel) return Permissions.NO_ACCESS;

    return getPermissions(accessLevel);
  };

  const downloadDocument = createCallback(async () => {
    try {
      const blob = await getBlob();
      downloadFile(blob, fileName());
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
          <TextButton
            text="Share"
            theme="accent"
            icon={ShareFat}
            onClick={() => setIsSharePermOpen(true)}
          />

          <TextButton
            text="Download"
            theme="accent"
            icon={DownloadSimple}
            onClick={downloadDocument}
          />
        </div>
      </div>
      <ShareModal
        id={documentId}
        name={fileName()}
        userPermissions={userPermissions()}
        itemType="document"
        isSharePermOpen={isSharePermOpen()}
        setIsSharePermOpen={setIsSharePermOpen}
      />
    </div>
  );
};
