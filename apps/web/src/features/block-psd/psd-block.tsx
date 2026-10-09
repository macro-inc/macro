/**
 * The Photoshop block: app chrome (header, file menu, sharing) around the
 * editor, wired to the worker engine, live collaboration, and document
 * storage.
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
import { useUserId } from '@core/context/user';
import { blockDataSignal } from '@core/internal/BlockLoader';
import { PsdEngine } from '@core/psd-engine/client';
import { blockMetadataSignal } from '@core/signal/load';
import { useCanEdit, useGetPermissions } from '@core/signal/permissions';
import { getDisplayName, tryMacroId } from '@core/user';
import {
  useBlockDocumentDownloadName,
  useBlockDocumentName,
} from '@core/util/currentBlockDocumentName';
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
import { SessionNotice } from './components/session-notice';
import {
  type PsdCollaboration,
  PsdEditorProvider,
  type PsdSharing,
} from './context/psd-editor-context';
import { fileFingerprint } from './core/collab-entries';
import type { PsdData } from './definition';
import { createPsdCollabSession } from './queries/psd-collab';
import { savePsdFile } from './queries/psd-file';
import { sharePsdEngine } from './queries/psd-sharing';
import {
  connectPsdSync,
  initializePsdSync,
  psdSyncExists,
} from './queries/psd-sync';
import { PsdEditor } from './views/psd-editor';

interface Notice {
  message: string;
  action: string;
  onAction: () => void;
}

function Opening() {
  return (
    <div
      class="flex size-full items-center justify-center text-ink-muted text-sm"
      data-testid="psd-opening"
    >
      Opening document…
    </div>
  );
}

/**
 * Opens the file in the engine (and, for a shared document, applies what
 * other people changed) and mounts the editor once ready.
 */
function PsdHost(props: {
  bytes: ArrayBuffer;
  fileName: () => string;
  documentId: string;
  canEdit: () => boolean;
  /** The shared document, when the document is edited live. */
  shared?: LoroDoc;
  collaboration?: PsdCollaboration;
  /** Whether every change made here reached the sync service. */
  delivered?: () => Promise<boolean>;
  /** Why the document is read-only, with the action that helps. */
  notice?: Notice;
}) {
  const [engine, setEngine] = createSignal<PsdEngine>();
  const [sharing, setSharing] = createSignal<PsdSharing>();
  const [failure, setFailure] = createSignal<string>();
  // Someone stored a file outside the shared document and started over on
  // it: this copy is out of date.
  const [replaced, setReplaced] = createSignal(false);
  const canEdit = () => props.canEdit() && !replaced();
  const notice = (): Notice | undefined =>
    replaced()
      ? {
          message:
            'This document was replaced by a newer file (an upload or an AI edit). Reload to edit the latest version.',
          action: 'Reload',
          onAction: () => window.location.reload(),
        }
      : props.notice;
  onMount(() => {
    let disposed = false;
    let opened: PsdEngine | undefined;
    let shared: PsdSharing | undefined;
    const open = async () => {
      try {
        // Before the engine takes the bytes.
        const fingerprint = props.shared
          ? await fileFingerprint(props.bytes)
          : undefined;
        const e = await PsdEngine.open(props.bytes, {
          onFailure: (error) => setFailure(error.message),
        });
        opened = e;
        if (disposed) return;
        if (props.shared && fingerprint) {
          shared = await sharePsdEngine(e, props.shared, {
            fingerprint,
            sessionsTaken: (props.collaboration?.peers() ?? []).map(
              (p) => p.presence.session
            ),
            delivered: props.delivered,
          });
          if (disposed) return;
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
    <Switch fallback={<Opening />}>
      <Match when={failure()}>
        {(message) => (
          <div class="flex size-full items-center justify-center p-6 text-center text-ink-muted text-sm">
            This document could not be opened: {message()}
          </div>
        )}
      </Match>
      <Match when={engine()}>
        {(e) => (
          <div class="flex size-full min-h-0 flex-col">
            <Show when={notice()}>{(n) => <SessionNotice {...n()} />}</Show>
            <div class="min-h-0 flex-1">
              <PsdEditorProvider
                context={{
                  engine: e(),
                  fileName: props.fileName,
                  download: (blob, name) => void downloadFile(blob, name),
                  notifyError: (message) => toast.failure(message),
                  notifyInfo: (message) => toast.success(message),
                  canEdit,
                  save: (bytes) => savePsdFile(props.documentId, bytes),
                  collaboration: props.collaboration,
                  sharing: sharing(),
                }}
              >
                <PsdEditor />
              </PsdEditorProvider>
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

/** Why a session that failed leaves the document read-only. */
const unavailable = (message: string) =>
  `${message} Live editing is unavailable, so the document is open read-only; editing offline could overwrite other people's changes.`;

/**
 * The document as everyone with access edits it live: changes since the
 * stored file go through the sync service (seeded the first time an editor
 * opens it). Viewers before that, and sessions that can't reach the sync
 * service, get the stored file read-only.
 */
function CollaborativePsdHost(props: {
  bytes: ArrayBuffer;
  fileName: () => string;
  documentId: string;
  canEdit: () => boolean;
}) {
  // Retrying starts a new session (and opens the file again). The child's
  // parameter makes Show call it again for each attempt.
  const [attempt, setAttempt] = createSignal(0);
  return (
    <Show when={attempt() + 1} keyed>
      {(_attempt) => (
        <PsdSession {...props} retry={() => setAttempt((n) => n + 1)} />
      )}
    </Show>
  );
}

function PsdSession(props: {
  bytes: ArrayBuffer;
  fileName: () => string;
  documentId: string;
  canEdit: () => boolean;
  retry: () => void;
}) {
  const userId = useUserId();
  const session = createPsdCollabSession({
    documentId: props.documentId,
    userId: userId(),
    canEdit: props.canEdit,
    displayName,
    exists: () => psdSyncExists(props.documentId),
    initialize: (snapshot) => initializePsdSync(props.documentId, snapshot),
    connect: () => connectPsdSync(props.documentId),
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
    <Switch fallback={<Opening />}>
      <Match when={session.state().t === 'unshared'}>
        <PsdHost {...props} canEdit={() => false} />
      </Match>
      <Match when={failed()}>
        {(message) => (
          <PsdHost
            {...props}
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
          <PsdHost
            {...props}
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
      Photoshop files can't be opened here yet.
      <Button variant="outline" size="sm" onClick={props.onDownload}>
        <DownloadSimple />
        Download
      </Button>
    </div>
  );
}

export default function PsdBlock(props: { share?: string }) {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const name = useBlockDocumentName('Image');
  const downloadName = useBlockDocumentDownloadName();
  const permissions = useGetPermissions();
  const canEdit = useCanEdit();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'psd',
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
      | (PsdData & { __block?: string })
      | undefined;
    return value?.__block === 'psd' ? value : undefined;
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
                  <CollaborativePsdHost
                    bytes={bytes()}
                    fileName={() => name() ?? 'Image'}
                    documentId={documentId}
                    canEdit={canEdit}
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
