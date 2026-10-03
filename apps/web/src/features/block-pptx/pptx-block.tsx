/**
 * The pptx block: app chrome (header, file menu, sharing) around the
 * presentation editor, wired to the worker engine and document storage.
 */

import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import {
  ResponsiveBlockToolbar,
  ResponsivePermissionsBadge,
} from '@components/app/ResponsiveBlockToolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { BlockItemSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { toast } from '@core/component/Toast/Toast';
import {
  getShareDrawerRecipientInput,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { blockMetadataSignal } from '@core/signal/load';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import { Button } from '@ui/components/Button';
import {
  createSignal,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  type PptxEditorContext,
  PptxEditorProvider,
  type PresentationEngine,
} from './context/pptx-editor-context';
import type { PptxData } from './definition';
import { openWorkerPresentation } from './queries/presentation-engine';
import { PPTX_MIME, savePresentationFile } from './queries/presentation-file';
import { PptxEditor } from './views/pptx-editor';

function download(bytes: Uint8Array | Blob, name: string) {
  const blob =
    bytes instanceof Blob
      ? bytes
      : new Blob([bytes as BlobPart], { type: PPTX_MIME });
  void downloadFile(blob, name);
}

/** Opens the bytes in the worker and mounts the editor once ready. */
function PresentationHost(props: {
  documentId: string;
  bytes: ArrayBuffer;
  canEdit: () => boolean;
  fileName: () => string;
  onEngine: (engine: PresentationEngine | undefined) => void;
}) {
  const [engine, setEngine] = createSignal<PresentationEngine>();
  const [failure, setFailure] = createSignal<string>();
  onMount(() => {
    let disposed = false;
    // A copy is transferred, so a remount can open the original again.
    openWorkerPresentation(props.bytes.slice(0))
      .then((e) => {
        if (disposed) {
          e.close();
          return;
        }
        setEngine(e);
        props.onEngine(e);
      })
      .catch((e: unknown) =>
        setFailure(e instanceof Error ? e.message : String(e))
      );
    onCleanup(() => {
      disposed = true;
      engine()?.close();
      props.onEngine(undefined);
    });
  });

  const context = (e: PresentationEngine): PptxEditorContext => ({
    engine: e,
    persist: (bytes) => savePresentationFile(props.documentId, bytes),
    canEdit: props.canEdit,
    fileName: props.fileName,
    download: (bytes, name) => download(bytes, name),
    notifyError: (message) => toast.failure(message),
  });

  return (
    <Switch
      fallback={
        <div class="flex size-full items-center justify-center text-ink-muted text-sm">
          Opening presentation…
        </div>
      }
    >
      <Match when={failure()}>
        {(message) => (
          <div class="flex size-full items-center justify-center p-6 text-center text-ink-muted text-sm">
            This presentation could not be opened: {message()}
          </div>
        )}
      </Match>
      <Match when={engine()}>
        {(e) => (
          <PptxEditorProvider context={context(e())}>
            <PptxEditor />
          </PptxEditorProvider>
        )}
      </Match>
    </Switch>
  );
}

function DownloadOnly(props: { onDownload: () => void }): JSX.Element {
  return (
    <div class="flex size-full flex-col items-center justify-center gap-3 p-6 text-ink-muted text-sm">
      Presentations can't be previewed here yet.
      <Button variant="outline" size="sm" onClick={props.onDownload}>
        <DownloadSimple />
        Download
      </Button>
    </div>
  );
}

export default function PptxBlock(props: { share?: string }) {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const name = useBlockDocumentName('Presentation');
  const downloadName = useBlockDocumentDownloadName();
  const canEdit = useCanEdit();
  const permissions = useGetPermissions();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'pptx',
    itemType: 'document',
    name: name() ?? '',
    userPermissions: permissions(),
    owner: blockMetadataSignal()?.owner,
  }));
  onMount(() => {
    if (props.share === 'true') openShare();
  });

  const data = () => {
    const value = blockDataSignal.get() as
      | (PptxData & { __block?: string })
      | undefined;
    return value?.__block === 'pptx' ? value : undefined;
  };

  const [engine, setEngine] = createSignal<PresentationEngine>();
  const downloadCurrent = async () => {
    try {
      const e = engine();
      if (e) {
        download(await e.save(), downloadName());
        return;
      }
      const url = data()?.blobUrl;
      if (!url) return;
      const response = await fetch(url);
      download(await response.blob(), downloadName());
    } catch {
      toast.failure('Error downloading file');
    }
  };

  return (
    <DocumentBlockContainer>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <SplitHeaderLeft>
          <BlockItemSplitLabel badges={<FileTypeChip />} />
        </SplitHeaderLeft>
        <SplitHeaderRight>
          <BlockLiveIndicators />
        </SplitHeaderRight>
        <ResponsivePermissionsBadge />
        <ResponsiveBlockToolbar
          id={documentId}
          itemType="document"
          name={name()}
          ops={[
            { op: 'rename' },
            { op: 'copy' },
            { op: 'moveToProject' },
            {
              group: 'file',
              label: 'Download',
              icon: DownloadSimple,
              action: () => void downloadCurrent(),
            },
            { op: 'delete' },
          ]}
          tools={[
            {
              group: 'sharing',
              label: 'Share',
              icon: IconShared,
              action: openShare,
              buttonComponent: () => <ShareTrigger onClick={openShare} />,
              focusTarget: getShareDrawerRecipientInput,
            },
          ]}
        />
        <div class="min-h-0 flex-1">
          <Show when={data()} keyed>
            {(d) => (
              <Show
                when={d.bytes}
                fallback={
                  <DownloadOnly onDownload={() => void downloadCurrent()} />
                }
              >
                {(bytes) => (
                  <PresentationHost
                    documentId={documentId}
                    bytes={bytes()}
                    canEdit={canEdit}
                    fileName={downloadName}
                    onEngine={setEngine}
                  />
                )}
              </Show>
            )}
          </Show>
        </div>
      </div>
    </DocumentBlockContainer>
  );
}
