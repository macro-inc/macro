import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useAuthor, useUserId } from '@core/context/user';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { watchPresentationChanges } from '@core/pptx-engine/changes';
import { blockMetadataSignal } from '@core/signal/load';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { fireAndForget } from '@core/util/fireAndForget';
import { downloadFile } from '@filesystem/download';
import DownloadSimple from '@icon/system/regular/download-simple.svg';
import { Button } from '@ui/components/Button';
import { LoroDoc } from 'loro-crdt';
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
  type PresentationCollaboration,
  type PresentationEngine,
} from './context/pptx-editor-context';
import type { PptxData } from './definition';
import { createPresentationCollabSession } from './queries/presentation-collab';
import {
  buildPresentationSeed,
  openCollaborativePresentation,
  openWorkerPresentation,
} from './queries/presentation-engine';
import {
  fetchPresentationFile,
  PPTX_MIME,
  savePresentationFile,
} from './queries/presentation-file';
import {
  connectPresentationSync,
  initializePresentationSync,
  presentationSyncExists,
} from './queries/presentation-sync';
import { MobilePptxHeader } from './views/mobile/pptx-header';
import { PptxEditor } from './views/pptx-editor';
import { PptxHeader } from './views/pptx-header';

/** Every save stores the whole file as a new version, so big decks save less often. */
const LARGE_DECK_BYTES = 5 * 1024 * 1024;
const LARGE_DECK_AUTOSAVE_MS = 5000;

function download(bytes: Uint8Array | Blob, name: string, mimeType?: string) {
  const blob =
    bytes instanceof Blob
      ? bytes
      : new Blob([bytes as BlobPart], { type: mimeType ?? PPTX_MIME });
  fireAndForget(downloadFile(blob, name), 'pptx-download');
}

/** Opens a presentation engine and mounts the editor once ready. */
function PresentationHost(props: {
  documentId: string;
  bytes: ArrayBuffer;
  canEdit: () => boolean;
  fileName: () => string;
  onEngine: (engine: PresentationEngine | undefined) => void;
  /** Opens the engine; the stored file by default. */
  open?: () => Promise<PresentationEngine>;
  collaboration?: PresentationCollaboration;
}) {
  const [engine, setEngine] = createSignal<PresentationEngine>();
  const [failure, setFailure] = createSignal<string>();
  const author = useAuthor();
  onMount(() => {
    let disposed = false;
    // A copy is transferred, so a remount can open the original again.
    (props.open?.() ?? openWorkerPresentation(props.bytes.slice(0)))
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
    download: (bytes, name, mimeType) => download(bytes, name, mimeType),
    notifyError: (message) => toast.failure(message),
    notifyInfo: (message) => toast.success(message),
    watchStoredFile: (onChange) =>
      watchPresentationChanges(props.documentId, onChange),
    fetchLatest: () => fetchPresentationFile(props.documentId),
    autosaveDelay:
      props.bytes.byteLength > LARGE_DECK_BYTES
        ? LARGE_DECK_AUTOSAVE_MS
        : undefined,
    collaboration: props.collaboration,
    currentUser: () => ({ name: author() }),
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

const displayName = (userId: string | undefined) =>
  getDisplayName(tryMacroId(userId ?? ''), { emailFallback: 'local-part' }) ||
  'Someone';

/**
 * The presentation as everyone with access edits it live: shared maps on the
 * sync service, seeded from the stored file the first time an editor opens
 * it. Viewers before that, and sessions that can't reach the sync service,
 * get the stored file (read-only when live editing is unavailable).
 */
function CollaborativePresentationHost(props: {
  documentId: string;
  bytes: ArrayBuffer;
  canEdit: () => boolean;
  fileName: () => string;
  onEngine: (engine: PresentationEngine | undefined) => void;
}) {
  const userId = useUserId();
  const session = createPresentationCollabSession({
    documentId: props.documentId,
    userId: userId(),
    canEdit: props.canEdit,
    displayName,
    exists: () => presentationSyncExists(props.documentId),
    buildSeed: () =>
      buildPresentationSeed(props.bytes.slice(0), () => new LoroDoc()),
    initialize: (snapshot) =>
      initializePresentationSync(props.documentId, snapshot),
    connect: () => connectPresentationSync(props.documentId),
  });
  return (
    <Switch
      fallback={
        <div class="flex size-full items-center justify-center text-ink-muted text-sm">
          Opening presentation…
        </div>
      }
    >
      <Match when={session.state().t === 'unshared'}>
        <PresentationHost {...props} canEdit={() => false} />
      </Match>
      <Match when={session.state().t === 'error'}>
        <PresentationHost {...props} canEdit={() => false} />
      </Match>
      <Match
        when={(() => {
          const state = session.state();
          return state.t === 'ready' ? state.doc : undefined;
        })()}
        keyed
      >
        {(doc) => (
          <PresentationHost
            {...props}
            open={() =>
              openCollaborativePresentation(doc, {
                storedFile: props.bytes.slice(0),
              })
            }
            collaboration={session.collaboration}
          />
        )}
      </Match>
    </Switch>
  );
}

function DownloadOnly(props: { onDownload: () => void }): JSX.Element {
  return (
    <div class="flex size-full flex-col items-center justify-center gap-3 p-6 text-ink-muted text-sm">
      Presentations can't be previewed here yet.
      <Button variant="secondary" size="sm" onClick={props.onDownload}>
        <DownloadSimple class="size-3 touch:size-6 shrink-0 pointer-events-none" />
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
        <Show
          when={isTouchDevice()}
          fallback={
            <PptxHeader
              documentId={documentId}
              name={name}
              openShare={openShare}
              download={downloadCurrent}
            />
          }
        >
          <MobilePptxHeader
            documentId={documentId}
            name={name}
            openShare={openShare}
            download={downloadCurrent}
          />
        </Show>
        <div class="min-h-0 flex-1">
          <Show when={data()} keyed>
            {(d) => (
              <Show
                when={d.bytes}
                fallback={
                  <DownloadOnly
                    onDownload={() =>
                      fireAndForget(downloadCurrent(), 'pptx-download')
                    }
                  />
                }
              >
                {(bytes) => (
                  <CollaborativePresentationHost
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
