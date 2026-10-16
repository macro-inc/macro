import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { blockMetadataSignal } from '@core/signal/load';
import { useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import { waitForDocumentContentReady } from '@queries/storage/document-location';
import { fetchDocumentMetadata } from '@queries/storage/document-metadata';
import { createCallback } from '@solid-primitives/rootless';
import {
  createSignal,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { SpreadsheetSkeleton } from '../../block-spreadsheet/components/SpreadsheetSkeleton';
import { isUploadedWorkbook } from '../../block-spreadsheet/core/uploaded-workbook';
import { useSpreadsheetAccess } from '../../block-spreadsheet/primitives/use-spreadsheet-access';
import {
  legacyOfficeUpgradeTarget,
  pollForLegacyUpgrade,
  shouldAwaitLegacyUpgrade,
  upgradedOfficeLabel,
} from '../legacy-office';
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
  const convertingTo = useLegacyOfficeUpgrade(blockId);

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
    <SidePanel.Layout defaultOpen={!spreadsheet()} floating>
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
                convertingTo={convertingTo()}
                onShare={openShare}
                onDownload={() => void downloadDocument()}
              />
            }
          >
            <Suspense fallback={<SpreadsheetSkeleton />}>
              <UploadedWorkbook />
            </Suspense>
          </Show>
        </div>
      </div>
    </SidePanel.Layout>
  );
}

/**
 * Waits for a just-uploaded .doc/.ppt/.xls to be upgraded to OpenXML, then
 * reopens it in the block for its new type. Returns the label of the format
 * being converted to while waiting.
 */
function useLegacyOfficeUpgrade(documentId: string) {
  const { replaceSplit } = useSplitLayout();
  const initial = blockMetadataSignal.get();
  const target = legacyOfficeUpgradeTarget(initial?.fileType);
  const [waiting, setWaiting] = createSignal(
    !!initial && !!target && shouldAwaitLegacyUpgrade(initial, Date.now())
  );

  onMount(() => {
    if (!target || !waiting()) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());

    void (async () => {
      const upgraded = await pollForLegacyUpgrade({
        target,
        fetchMetadata: () => fetchDocumentMetadata(documentId),
        fileTypeOf: (metadata) => metadata.fileType,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!upgraded) {
        setWaiting(false);
        return;
      }
      // Word content becomes readable once the DOCX pipeline processes it.
      if (target === 'docx') {
        await waitForDocumentContentReady({
          documentId,
          timeoutMs: 60_000,
        }).catch(() => undefined);
        if (controller.signal.aborted) return;
      }
      const blockName = fileTypeToBlockName(upgraded.fileType);
      if (blockName === 'unknown') {
        // Excel workbooks stay in this block, which previews them.
        blockMetadataSignal.set(upgraded);
        setWaiting(false);
        return;
      }
      replaceSplit({ content: { type: blockName, id: documentId } });
    })();
  });

  return () => (waiting() && target ? upgradedOfficeLabel(target) : undefined);
}
