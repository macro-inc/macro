/**
 * The `.ai` block: app chrome (header, file menu, sharing) around the
 * Illustrator editor, wired to the worker engine, document storage, and
 * the sync service.
 */

import { createFontSource } from '@app/features/block-fig/queries/font-source';
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
import { AiEngine } from '@core/ai-engine/client';
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
import { SessionNotice } from './components/notices';
import {
  type AiCollaboration,
  AiEditorProvider,
  type AiSharing,
} from './context/ai-editor-context';
import { fileFingerprint } from './core/collab-entries';
import type { AiData } from './definition';
import { createAiCollabSession } from './queries/ai-collab';
import { saveAiFile } from './queries/ai-file';
import { shareAiEngine } from './queries/ai-sharing';
import {
  connectDocumentSync,
  documentSyncExists,
  initializeDocumentSync,
} from './queries/ai-sync';
import { AiEditorView } from './views/ai-editor';

/** What the block shows while the engine reads the file. */
function Opening(): JSX.Element {
  return (
    <div
      class="flex size-full items-center justify-center text-ink-muted text-sm"
      data-testid="ai-opening"
    >
      Opening Illustrator file…
    </div>
  );
}

/**
 * Opens the file in the engine (and, for a shared document, applies what
 * other people changed) and mounts the editor once ready.
 */
function AiHost(props: {
  bytes: ArrayBuffer;
  fileName: () => string;
  documentId: string;
  canEdit: () => boolean;
  /** The shared document, when it is edited live. */
  shared?: LoroDoc;
  collaboration?: AiCollaboration;
  /** Whether every change made here reached the sync service. */
  delivered?: () => Promise<boolean>;
  /** Why the document is read-only, with the action that helps. */
  notice?: { message: string; action: string; onAction: () => void };
}) {
  const [engine, setEngine] = createSignal<AiEngine>();
  const [sharing, setSharing] = createSignal<AiSharing>();
  const [failure, setFailure] = createSignal<string>();
  // Someone opened a file stored outside the shared document and started
  // over on it: this copy is out of date.
  const [replaced, setReplaced] = createSignal(false);
  const canEdit = () => props.canEdit() && !replaced();
  const notice = () =>
    replaced()
      ? {
          message:
            'This file was replaced by a newer version (an upload or an AI edit). Reload to edit the latest version.',
          action: 'Reload',
          onAction: () => window.location.reload(),
        }
      : props.notice;
  onMount(() => {
    let disposed = false;
    let opened: AiEngine | undefined;
    let shared: AiSharing | undefined;
    const open = async () => {
      try {
        // Before the engine takes the bytes.
        const fingerprint = props.shared
          ? await fileFingerprint(props.bytes)
          : undefined;
        const e = await AiEngine.open(props.bytes, {
          onFailure: (error) => setFailure(error.message),
        });
        opened = e;
        if (disposed) return;
        if (props.shared && fingerprint) {
          const collaboration = props.collaboration;
          shared = await shareAiEngine(e, props.shared, {
            fingerprint,
            takenSessions: () =>
              collaboration?.peers().map((p) => p.presence.session) ?? [],
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
            This file could not be opened: {message()}
          </div>
        )}
      </Match>
      <Match when={engine()}>
        {(e) => (
          <div class="flex size-full min-h-0 flex-col">
            <Show when={notice()}>{(n) => <SessionNotice {...n()} />}</Show>
            <div class="min-h-0 flex-1">
              <AiEditorProvider
                context={{
                  engine: e(),
                  fileName: props.fileName,
                  download: (blob, name) => void downloadFile(blob, name),
                  notifyError: (message) => toast.failure(message),
                  notifyInfo: (message) => toast.success(message),
                  canEdit,
                  save: (bytes) => saveAiFile(props.documentId, bytes),
                  collaboration: props.collaboration,
                  sharing: sharing(),
                  fonts: createFontSource(),
                }}
              >
                <AiEditorView />
              </AiEditorProvider>
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
 * The document as everyone with access edits it live: changes since the
 * stored file go through the sync service (seeded the first time an editor
 * opens it). Viewers before that, and sessions that can't reach the sync
 * service, get the stored file read-only.
 */
function CollaborativeAiHost(props: {
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
        <DocumentSession {...props} retry={() => setAttempt((n) => n + 1)} />
      )}
    </Show>
  );
}

/** Why a session that failed leaves the document read-only. */
const unavailable = (message: string) =>
  `${message} Live editing is unavailable, so the file is open read-only; editing offline could overwrite other people's changes.`;

function DocumentSession(props: {
  bytes: ArrayBuffer;
  fileName: () => string;
  documentId: string;
  canEdit: () => boolean;
  retry: () => void;
}) {
  const userId = useUserId();
  const session = createAiCollabSession({
    documentId: props.documentId,
    userId: userId(),
    canEdit: props.canEdit,
    displayName,
    exists: () => documentSyncExists(props.documentId),
    initialize: (snapshot) =>
      initializeDocumentSync(props.documentId, snapshot),
    connect: () => connectDocumentSync(props.documentId),
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
        <AiHost {...props} canEdit={() => false} />
      </Match>
      <Match when={failed()}>
        {(message) => (
          <AiHost
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
          <AiHost
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
      Illustrator files can't be edited here yet.
      <Button variant="outline" size="sm" onClick={props.onDownload}>
        <DownloadSimple />
        Download
      </Button>
    </div>
  );
}

export default function AiBlock(props: { share?: string }) {
  useBlockEntityCommands();
  const documentId = useBlockId();
  const name = useBlockDocumentName('Illustration');
  const downloadName = useBlockDocumentDownloadName();
  const permissions = useGetPermissions();
  const canEdit = useCanEdit();
  const openShare = useShareModal(() => ({
    id: documentId,
    blockAlias: 'ai',
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
      | (AiData & { __block?: string })
      | undefined;
    return value?.__block === 'ai' ? value : undefined;
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
                  <CollaborativeAiHost
                    bytes={bytes()}
                    fileName={() => name() ?? 'Illustration'}
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
