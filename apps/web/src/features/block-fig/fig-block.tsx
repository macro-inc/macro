/**
 * The `.fig` block: app chrome (header, file menu, sharing) around the
 * viewer, wired to the worker engine and document storage.
 */

import { CommandState } from '@app/features/command';
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
import { IS_MAC } from '@core/constant/isMac';
import { useUserId } from '@core/context/user';
import type { FigEngine } from '@core/fig-engine/client';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { blockMetadataSignal } from '@core/signal/load';
import {
  useCanComment,
  useCanEdit,
  useGetPermissions,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
import { buildSimpleEntityUrl } from '@core/util/url';
import { downloadFile } from '@filesystem/download';
import IconShared from '@icon/share.svg';
import DownloadSimple from '@phosphor/download-simple.svg';
import { Button } from '@ui/components/Button';
import type { LoroDoc } from 'loro-crdt';
import {
  createSignal,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { FigOpening } from './components/fig-opening';
import { SessionNotice } from './components/session-notice';
import type { FigCommentStore } from './context/fig-comments';
import {
  type FigCollaboration,
  type FigSharing,
  FigViewerProvider,
} from './context/fig-viewer-context';
import type { FigData } from './definition';
import { createDesignCollabSession } from './queries/fig-collab';
import { saveFigFile } from './queries/fig-file';
import { useFigLibrarySource } from './queries/fig-libraries';
import { shareFigEngine } from './queries/fig-sharing';
import {
  connectDesignSync,
  designSyncExists,
  initializeDesignSync,
} from './queries/fig-sync';
import { createFontSource } from './queries/font-source';
import { openFigEngine, prepareFigEngine } from './queries/prepare-engine';
import { FigViewer } from './views/fig-viewer';
import { useMacroComments } from './views/macro-comments';

/**
 * ⌘K on a design opens the command menu, which then offers the design
 * palette (Figma's actions menu, ⌘P here).
 */
const suggestActions = (openActions: () => void) =>
  CommandState.setHint({
    message: 'Did you mean to open the design palette?',
    shortcut: IS_MAC ? '⌘P' : 'Ctrl+P',
    matches: (e) =>
      (IS_MAC ? e.metaKey : e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      e.code === 'KeyP',
    run: openActions,
  });

/**
 * Opens the file in the engine (and, for a shared design, applies what
 * other people changed) and mounts the viewer once ready.
 */
function FigHost(props: {
  bytes: ArrayBuffer;
  fileName: () => string;
  documentId: string;
  canEdit: () => boolean;
  /** The shared document, when the design is edited live. */
  shared?: LoroDoc;
  collaboration?: FigCollaboration;
  /** Whether every change made here reached the sync service. */
  delivered?: () => Promise<boolean>;
  /** Parsing already in progress while the shared session connects. */
  opening?: ReturnType<typeof prepareFigEngine>;
  /** Why the design is read-only, with the action that helps. */
  notice?: { message: string; action: string; onAction: () => void };
  comments?: FigCommentStore;
  /** A frame to present on opening (from a frame link). */
  present?: string;
}) {
  const [engine, setEngine] = createSignal<FigEngine>();
  const [sharing, setSharing] = createSignal<FigSharing>();
  const libraries = useFigLibrarySource(props.documentId);
  const [failure, setFailure] = createSignal<string>();
  // Someone opened a file stored outside the shared design and started over
  // on it: this copy is out of date.
  const [replaced, setReplaced] = createSignal(false);
  const canEdit = () => props.canEdit() && !replaced();
  const notice = () =>
    replaced()
      ? {
          message:
            'This design was replaced by a newer file (an upload or an AI edit). Reload to edit the latest version.',
          action: 'Reload',
          onAction: () => window.location.reload(),
        }
      : props.notice;
  onMount(() => {
    let disposed = false;
    let opened: FigEngine | undefined;
    let shared: FigSharing | undefined;
    const open = async () => {
      try {
        const onFailure = (error: Error) => setFailure(error.message);
        const { engine: e, fingerprint } = props.opening
          ? await props.opening.take(onFailure)
          : await openFigEngine(props.bytes, onFailure);
        opened = e;
        if (disposed) {
          e.close();
          return;
        }
        if (props.shared && fingerprint) {
          shared = await shareFigEngine(e, props.shared, {
            fingerprint,
            delivered: props.delivered,
          });
          if (disposed) {
            shared.close();
            return;
          }
          shared.onReplaced(() => setReplaced(true));
          setSharing(shared);
        }
        setEngine(e);
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e));
      }
    };
    void open();
    onCleanup(() => {
      disposed = true;
      shared?.close();
      opened?.close();
    });
  });

  return (
    <Switch fallback={<FigOpening />}>
      <Match when={failure()}>
        {(message) => (
          <div class="flex size-full items-center justify-center p-6 text-center text-ink-muted text-sm">
            This design could not be opened: {message()}
          </div>
        )}
      </Match>
      <Match when={engine()}>
        {(e) => (
          <div class="flex size-full min-h-0 flex-col">
            <Show when={notice()}>{(n) => <SessionNotice {...n()} />}</Show>
            <div class="min-h-0 flex-1">
              <FigViewerProvider
                context={{
                  engine: e(),
                  fileName: props.fileName,
                  download: (blob, name) => void downloadFile(blob, name),
                  notifyError: (message) => toast.failure(message),
                  notifyInfo: (message) => toast.success(message),
                  canEdit,
                  save: (bytes) => saveFigFile(props.documentId, bytes),
                  fileKey: props.documentId,
                  collaboration: props.collaboration,
                  sharing: sharing(),
                  comments: props.comments,
                  frameLink: (frame) =>
                    buildSimpleEntityUrl(
                      { type: 'fig', id: props.documentId },
                      { present: frame }
                    ),
                  presentAt: props.present,
                  fonts: createFontSource(),
                  libraries,
                  suggestActions,
                }}
              >
                <FigViewer />
              </FigViewerProvider>
            </div>
          </div>
        )}
      </Match>
    </Switch>
  );
}

const displayName = (userId: string | undefined) =>
  getDisplayName(tryMacroId(userId ?? ''), { emailFallback: 'local-part' }) ||
  'Someone';

/**
 * The design as everyone with access edits it live: changes since the
 * stored file go through the sync service (seeded the first time an editor
 * opens it). Viewers before that, and sessions that can't reach the sync
 * service, get the stored file read-only.
 */
function CollaborativeFigHost(props: {
  bytes: ArrayBuffer;
  fileName: () => string;
  documentId: string;
  canEdit: () => boolean;
  comments?: FigCommentStore;
  present?: string;
}) {
  // Retrying starts a new session (and opens the file again). The child's
  // parameter makes Show call it again for each attempt.
  const [attempt, setAttempt] = createSignal(0);
  return (
    <Show when={attempt() + 1} keyed>
      {(_attempt) => (
        <DesignSession {...props} retry={() => setAttempt((n) => n + 1)} />
      )}
    </Show>
  );
}

/** Why a session that failed leaves the design read-only. */
const unavailable = (message: string) =>
  `${message} Live editing is unavailable, so the design is open read-only; editing offline could overwrite other people's changes.`;

function DesignSession(props: {
  bytes: ArrayBuffer;
  fileName: () => string;
  documentId: string;
  canEdit: () => boolean;
  comments?: FigCommentStore;
  present?: string;
  retry: () => void;
}) {
  const userId = useUserId();
  const opening = prepareFigEngine(props.bytes);
  onCleanup(() => void opening.dispose());
  const session = createDesignCollabSession({
    documentId: props.documentId,
    userId: userId(),
    canEdit: props.canEdit,
    displayName,
    exists: () => designSyncExists(props.documentId),
    initialize: (snapshot) => initializeDesignSync(props.documentId, snapshot),
    connect: () => connectDesignSync(props.documentId),
  });
  const ready = () => {
    const state = session.state();
    return state.t === 'ready' ? state.doc : undefined;
  };
  const failed = () => {
    const state = session.state();
    return state.t === 'error' ? state.message : undefined;
  };
  return (
    <Switch fallback={<FigOpening />}>
      <Match when={session.state().t === 'unshared'}>
        <FigHost {...props} opening={opening} canEdit={() => false} />
      </Match>
      <Match when={failed()}>
        {(message) => (
          <FigHost
            {...props}
            opening={opening}
            canEdit={() => false}
            notice={
              props.canEdit()
                ? {
                    message: unavailable(message()),
                    action: 'Retry',
                    onAction: props.retry,
                  }
                : undefined
            }
          />
        )}
      </Match>
      <Match when={ready()} keyed>
        {(doc) => (
          <FigHost
            {...props}
            opening={opening}
            shared={doc}
            collaboration={session.collaboration}
            delivered={session.delivered}
          />
        )}
      </Match>
    </Switch>
  );
}

function DownloadOnly(props: { onDownload: () => void }): JSX.Element {
  return (
    <div class="flex size-full flex-col items-center justify-center gap-3 p-6 text-ink-muted text-sm">
      Figma files can't be previewed here yet.
      <Button variant="outline" size="sm" onClick={props.onDownload}>
        <DownloadSimple />
        Download
      </Button>
    </div>
  );
}

export default function FigBlock(props: { share?: string; present?: string }) {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const name = useBlockDocumentName('Design');
  const downloadName = useBlockDocumentDownloadName();
  const permissions = useGetPermissions();
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const isOwner = useIsDocumentOwner();
  const userId = useUserId();
  const comments = useMacroComments({
    documentId,
    userId,
    canComment,
    canModerate: isOwner,
    displayName,
  });
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'fig',
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
      | (FigData & { __block?: string })
      | undefined;
    return value?.__block === 'fig' ? value : undefined;
  };

  const download = async () => {
    try {
      const url = data()?.blobUrl;
      if (!url) return;
      const response = await fetch(url);
      void downloadFile(await response.blob(), downloadName());
    } catch {
      toast.failure('Error downloading file');
    }
  };

  return (
    <div class="size-full border-edge-frame border-t">
      <DocumentBlockContainer loadingFallback={<FigOpening />}>
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
                action: () => void download(),
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
                  fallback={<DownloadOnly onDownload={() => void download()} />}
                >
                  {(bytes) => (
                    <CollaborativeFigHost
                      bytes={bytes()}
                      fileName={() => name() ?? 'Design'}
                      documentId={documentId}
                      canEdit={canEdit}
                      comments={comments}
                      present={props.present}
                    />
                  )}
                </Show>
              )}
            </Show>
          </div>
        </div>
      </DocumentBlockContainer>
    </div>
  );
}
