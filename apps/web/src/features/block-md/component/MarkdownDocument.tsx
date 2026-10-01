import {
  type AutomergeManager,
  createAutomergeManager,
} from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import {
  AUTOMERGE_SNAPSHOT_DB_NAME,
  IDBSnapshotStore,
} from '@macro-inc/collaboration/collab/snapshot-store';
import type {
  InitialSync,
  SyncError,
} from '@macro-inc/collaboration/collab/source';
import {
  AUTOMERGE_WAL_DB_NAME,
  BrowserWALStore,
} from '@macro-inc/collaboration/collab/wal';
import { MARKDOWN_AUTOMERGE_SCHEMA } from '@macro-inc/lexical-core/markdown-automerge-schema';
import type { Span } from '@macro-inc/observability';
import { Scroll } from '@ui';
import type { ResultAsync } from 'neverthrow';
import {
  createEffect,
  createSignal,
  on,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import {
  type MarkdownDocumentContextValue,
  MarkdownDocumentProvider,
  useMarkdownDocument,
} from '../context/markdown-document-context';
import {
  createMarkdownDocumentState,
  type MarkdownDocumentState,
} from '../context/markdown-document-state';
import { HistoryProvider } from '../history/HistoryContext';
import {
  resumeDocumentSpan,
  stampAutomergeSnapshotState,
} from '../observability';
import type { MarkdownDocumentKind, MarkdownDocumentSource } from '../types';
import { MarkdownNameProvider } from './MarkdownNameProvider';
import { InstructionsNotebook, Notebook } from './Notebook';

type MarkdownAutomergeManager = AutomergeManager<
  typeof MARKDOWN_AUTOMERGE_SCHEMA
>;
type SnapshotResult = {
  outcome: 'seeded' | 'discarded' | 'unavailable' | 'error';
  bytes?: number;
};

const snapshotStepNames = {
  optimistic: 'doc.snapshot.optimistic',
  local: 'doc.snapshot.local-cache',
  s3: 'doc.snapshot.s3-cache',
  remote: 'doc.snapshot.remote-sync',
} as const;

type SnapshotSource = keyof typeof snapshotStepNames;

async function recordSnapshotResult(
  parentSpan: Span | undefined,
  source: SnapshotSource,
  operation: Promise<SnapshotResult>
): Promise<void> {
  try {
    const { outcome, bytes } = await operation;
    parentSpan?.event('doc.snapshot.result', {
      'snapshot.source': source,
      ...(bytes !== undefined && { 'snapshot.bytes': bytes }),
      outcome,
    });
  } catch {
    parentSpan?.event('doc.snapshot.result', {
      'snapshot.source': source,
      outcome: 'error',
    });
  }
}

function startSnapshotIngest(
  parentSpan: Span | undefined,
  source: SnapshotSource,
  automergeManager: MarkdownAutomergeManager,
  ingest: () => Promise<SnapshotResult>
): void {
  parentSpan?.event('doc.snapshot.attempt', {
    'snapshot.source': source,
  });

  const operation = parentSpan
    ? parentSpan.span(snapshotStepNames[source], async (snapshotSpan) => {
        snapshotSpan.setAttr('snapshot.source', source);
        try {
          const result = await ingest();
          snapshotSpan.setAttr('outcome', result.outcome);
          if (result.bytes !== undefined) {
            snapshotSpan.setAttr('snapshot.bytes', result.bytes);
          }
          if (result.outcome === 'seeded') {
            stampAutomergeSnapshotState(snapshotSpan, automergeManager.doc);
          } else if (result.outcome === 'error') {
            snapshotSpan.error('snapshot ingestion failed');
          }
          return result;
        } catch (error) {
          snapshotSpan.error(error);
          snapshotSpan.setAttr('outcome', 'error');
          throw error;
        }
      })
    : ingest();

  void recordSnapshotResult(parentSpan, source, operation);
}

async function ingestLocalSnapshot(
  automergeManager: MarkdownAutomergeManager,
  snapshotStore: IDBSnapshotStore<RawUpdate>,
  walStore: BrowserWALStore<RawUpdate>
): Promise<SnapshotResult> {
  const localSnapshot = await snapshotStore.load();
  if (!localSnapshot) return { outcome: 'unavailable' };
  const walEntries = await walStore.getAll();
  const seeded = await automergeManager.ingest({
    kind: 'local',
    snapshot: localSnapshot,
    walUpdates: walEntries.map((entry) => entry.update),
  });

  if (walEntries.length >= 1) {
    const doc = automergeManager.doc;
    const snapshot = doc.export({
      mode: 'shallow-snapshot',
      frontiers: doc.oplogFrontiers(),
    });
    await snapshotStore.save(snapshot);
  }
  return {
    outcome: seeded ? 'seeded' : 'discarded',
    bytes: localSnapshot.length,
  };
}

async function ingestRemoteSnapshot(
  automergeManager: MarkdownAutomergeManager,
  doInitialSync: () => ResultAsync<InitialSync, SyncError>
): Promise<SnapshotResult> {
  const sync = await doInitialSync();
  if (sync.isErr()) {
    console.error('Failed to receive initial sync', sync.error);
    return { outcome: 'error' };
  }
  const bytes = sync.value.snapshot.length;
  const seeded = await automergeManager.ingest({
    kind: 'dss',
    snapshot: sync.value.snapshot,
  });
  return { outcome: seeded ? 'seeded' : 'discarded', bytes };
}

async function ingestS3Snapshot(
  automergeManager: MarkdownAutomergeManager,
  loadCachedSnapshot: () => Promise<Uint8Array | undefined>
): Promise<SnapshotResult> {
  const snapshot = await loadCachedSnapshot();
  if (!snapshot) return { outcome: 'unavailable' };
  const seeded = await automergeManager.ingest({
    kind: 's3',
    snapshot,
  });
  return {
    outcome: seeded ? 'seeded' : 'discarded',
    bytes: snapshot.length,
  };
}

type MarkdownDocumentProps = {
  documentId: string;
  kind: MarkdownDocumentKind;
  state?: MarkdownDocumentState;
  documentSource: MarkdownDocumentSource;
  permissions: {
    canComment: boolean;
    canEdit: boolean;
    isOwner: boolean;
  };
  persistedName: string | undefined;
  fallbackName: string | undefined;
};

export function MarkdownDocument(props: ParentProps<MarkdownDocumentProps>) {
  const [surfaceElement, setSurfaceElement] = createSignal<HTMLElement>();

  const state = props.state ?? createMarkdownDocumentState();

  const context: MarkdownDocumentContextValue = {
    documentId: () => props.documentId,
    kind: () => props.kind,
    documentSource: () => props.documentSource,
    permissions: {
      canComment: () => props.permissions.canComment,
      canEdit: () => props.permissions.canEdit,
      isOwner: () => props.permissions.isOwner,
    },
    persistedName: () => props.persistedName,
    fallbackName: () => props.fallbackName,
    state,
    element: surfaceElement,
  };

  return (
    <MarkdownDocumentProvider context={context}>
      <MarkdownNameProvider>
        <div
          ref={setSurfaceElement}
          class="size-full select-none overscroll-none overflow-hidden flex flex-col relative"
          tabIndex={-1}
        >
          <HistoryProvider documentId={() => props.documentId}>
            {props.children}
          </HistoryProvider>
        </div>
      </MarkdownNameProvider>
    </MarkdownDocumentProvider>
  );
}

type MarkdownSnapshotIngestOptions = {
  doInitialSync?: () => ResultAsync<InitialSync, SyncError>;
  optimisticSnapshot?: Uint8Array<ArrayBufferLike>;
  loadCachedSnapshot?: () => Promise<Uint8Array | undefined>;
  onDataReady?: () => void;
};

function useMarkdownSnapshotIngest(
  automergeManager: MarkdownAutomergeManager,
  options: MarkdownSnapshotIngestOptions
) {
  const { documentId: getDocumentId } = useMarkdownDocument();
  const documentId = getDocumentId();
  const snapshotStore = new IDBSnapshotStore<RawUpdate>(
    AUTOMERGE_SNAPSHOT_DB_NAME,
    documentId
  );
  const walStore = new BrowserWALStore<RawUpdate>(
    AUTOMERGE_WAL_DB_NAME,
    documentId
  );

  createEffect(
    on(
      () => options.doInitialSync,
      (doInitialSync) => {
        if (!doInitialSync) return;
        options.onDataReady?.();

        const span = resumeDocumentSpan(documentId);
        if (options.optimisticSnapshot) {
          startSnapshotIngest(
            span,
            'optimistic',
            automergeManager,
            async () => {
              const seeded = await automergeManager.ingest({
                kind: 'optimistic',
                snapshot: options.optimisticSnapshot!,
              });
              return {
                outcome: seeded ? 'seeded' : 'discarded',
                bytes: options.optimisticSnapshot!.length,
              };
            }
          );
        }
        startSnapshotIngest(span, 'local', automergeManager, () =>
          ingestLocalSnapshot(automergeManager, snapshotStore, walStore)
        );
        startSnapshotIngest(span, 's3', automergeManager, () =>
          ingestS3Snapshot(
            automergeManager,
            options.loadCachedSnapshot ?? (async () => undefined)
          )
        );
        startSnapshotIngest(span, 'remote', automergeManager, () =>
          ingestRemoteSnapshot(automergeManager, doInitialSync)
        );
      }
    )
  );
}

export type MarkdownDocumentContentProps = MarkdownSnapshotIngestOptions & {
  isInstructions?: boolean;
  hotkeyScope?: string;
  autoFocus?: boolean;
};

export function MarkdownDocumentContent(props: MarkdownDocumentContentProps) {
  const { documentId: getDocumentId, state } = useMarkdownDocument();
  const documentId = getDocumentId();

  const automergeManager = createAutomergeManager(MARKDOWN_AUTOMERGE_SCHEMA, {
    documentId,
  });

  useMarkdownSnapshotIngest(automergeManager, props);

  const isInstructions = () => props.isInstructions ?? false;

  return (
    <div class="w-full grow overflow-hidden relative" data-block-content>
      <Scroll
        class="relative"
        scrollRef={(element) => {
          state.editor.setMd({
            scrollContainer: element,
          });
        }}
      >
        <div class="relative portal-scope touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
          <Suspense>
            <Show
              when={!isInstructions()}
              fallback={
                <InstructionsNotebook
                  automergeManager={automergeManager}
                  hotkeyScope={props.hotkeyScope}
                />
              }
            >
              <Notebook
                automergeManager={automergeManager}
                documentId={documentId}
                hotkeyScope={props.hotkeyScope}
                autoFocus={props.autoFocus ?? false}
              />
            </Show>
          </Suspense>
        </div>
      </Scroll>
    </div>
  );
}
