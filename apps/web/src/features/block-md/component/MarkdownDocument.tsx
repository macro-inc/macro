import { SidePanel } from '@components/app/side-panel';
import {
  createLoroManager,
  type LoroManager,
} from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import {
  IDBSnapshotStore,
  LORO_SNAPSHOT_DB_NAME,
} from '@macro-inc/collaboration/collab/snapshot-store';
import {
  BrowserWALStore,
  LORO_WAL_DB_NAME,
} from '@macro-inc/collaboration/collab/wal';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import type { Span } from '@macro-inc/observability';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import { Scroll } from '@ui';
import { createEffect, createSignal, on, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type MarkdownDocumentContextValue,
  type MarkdownDocumentData,
  type MarkdownDocumentProps,
  MarkdownDocumentProvider,
  useMarkdownDocument,
} from '../context/markdown-document-context';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import { HistoryProvider } from '../history/HistoryContext';
import { resumeDocumentSpan, stampLoroSnapshotState } from '../observability';
import { FindAndReplace } from './FindAndReplace';
import { MarkdownNameProvider } from './MarkdownNameProvider';
import { InstructionsNotebook, Notebook } from './Notebook';

type MarkdownLoroManager = LoroManager<typeof MARKDOWN_LORO_SCHEMA>;
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
  loroManager: MarkdownLoroManager,
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
            stampLoroSnapshotState(snapshotSpan, loroManager.doc);
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
  loroManager: MarkdownLoroManager,
  snapshotStore: IDBSnapshotStore<RawUpdate>,
  walStore: BrowserWALStore<RawUpdate>
): Promise<SnapshotResult> {
  const localSnapshot = await snapshotStore.load();
  if (!localSnapshot) return { outcome: 'unavailable' };
  const walEntries = await walStore.getAll();
  const seeded = await loroManager.ingest({
    kind: 'local',
    snapshot: localSnapshot,
    walUpdates: walEntries.map((entry) => entry.update),
  });

  if (walEntries.length >= 1) {
    const doc = loroManager.doc;
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
  loroManager: MarkdownLoroManager,
  doInitialSync: MarkdownDocumentData['doInitialSync']
): Promise<SnapshotResult> {
  const sync = await doInitialSync();
  if (sync.isErr()) {
    console.error('Failed to receive initial sync', sync.error);
    return { outcome: 'error' };
  }
  const bytes = sync.value.snapshot.length;
  const seeded = await loroManager.ingest({
    kind: 'dss',
    snapshot: sync.value.snapshot,
  });
  return { outcome: seeded ? 'seeded' : 'discarded', bytes };
}

async function ingestS3Snapshot(
  loroManager: MarkdownLoroManager,
  loadCachedSnapshot: () => Promise<Uint8Array | undefined>
): Promise<SnapshotResult> {
  const snapshot = await loadCachedSnapshot();
  if (!snapshot) return { outcome: 'unavailable' };
  const seeded = await loroManager.ingest({
    kind: 's3',
    snapshot,
  });
  return {
    outcome: seeded ? 'seeded' : 'discarded',
    bytes: snapshot.length,
  };
}

export function MarkdownDocument(props: MarkdownDocumentProps) {
  const [surfaceElement, setSurfaceElement] = createSignal<HTMLElement>();
  const state = createMarkdownDocumentState(props.documentId);
  const context: MarkdownDocumentContextValue = {
    ...props,
    state,
    element: () => props.hostElement?.() ?? surfaceElement(),
    isInstructions: props.isInstructions ?? (() => false),
    hotkeyScope: props.hotkeyScope ?? (() => undefined),
    autoFocus: props.autoFocus ?? false,
    navigatedFromJK: props.navigatedFromJK ?? (() => false),
    loadCachedSnapshot: props.loadCachedSnapshot ?? (async () => undefined),
    onDataReady: props.onDataReady ?? (() => {}),
    registerMethods: props.registerMethods ?? (() => {}),
  };

  return (
    <MarkdownDocumentProvider context={context}>
      <MarkdownNameProvider>
        <MarkdownDocumentContent
          {...props}
          setSurfaceElement={setSurfaceElement}
        />
      </MarkdownNameProvider>
    </MarkdownDocumentProvider>
  );
}

function MarkdownDocumentContent(
  props: MarkdownDocumentProps & {
    setSurfaceElement: (element: HTMLElement) => void;
  }
) {
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();
  const markdownDocument = useMarkdownDocument();
  const documentId = markdownDocument.documentId;

  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId,
  });
  const snapshotStore = new IDBSnapshotStore<RawUpdate>(
    LORO_SNAPSHOT_DB_NAME,
    documentId
  );
  const walStore = new BrowserWALStore<RawUpdate>(LORO_WAL_DB_NAME, documentId);

  createEffect(
    on(markdownDocument.data, (data) => {
      if (!data) return;
      markdownDocument.onDataReady();

      const span = resumeDocumentSpan(documentId);
      if (props.optimisticSnapshot) {
        startSnapshotIngest(span, 'optimistic', loroManager, async () => {
          const seeded = await loroManager.ingest({
            kind: 'optimistic',
            snapshot: props.optimisticSnapshot!,
          });
          return {
            outcome: seeded ? 'seeded' : 'discarded',
            bytes: props.optimisticSnapshot!.length,
          };
        });
      }
      startSnapshotIngest(span, 'local', loroManager, () =>
        ingestLocalSnapshot(loroManager, snapshotStore, walStore)
      );
      startSnapshotIngest(span, 's3', loroManager, () =>
        ingestS3Snapshot(loroManager, markdownDocument.loadCachedSnapshot)
      );
      startSnapshotIngest(span, 'remote', loroManager, () =>
        ingestRemoteSnapshot(loroManager, data.doInitialSync)
      );
    })
  );

  createEffect(() => {
    const element = scrollRef();
    if (element) {
      markdownDocument.state.editor.setMd({ scrollContainer: element });
    }
  });

  const TopBar = () =>
    markdownDocument.isInstructions() ? props.instructionsTopBar : props.topBar;

  return (
    <div
      ref={props.setSurfaceElement}
      class="size-full select-none overscroll-none overflow-hidden flex flex-col relative"
      tabIndex={-1}
    >
      <HistoryProvider documentId={() => documentId}>
        {props.historyOverlay ? (
          <Dynamic component={props.historyOverlay} />
        ) : null}
        <SidePanel.Layout>
          <Show when={!markdownDocument.isInstructions()}>
            {props.sidePanel ? <Dynamic component={props.sidePanel} /> : null}
          </Show>
          <div class="flex flex-col size-full">
            <div class="relative shrink-0">
              <Suspense>
                <Dynamic component={TopBar()} />
              </Suspense>
              <Suspense>
                <Show when={!markdownDocument.isInstructions()}>
                  <div class="absolute right-4 top-1.5 z-action-menu flex justify-end">
                    <FindAndReplace />
                  </div>
                </Show>
              </Suspense>
            </div>
            <Show when={markdownDocument.notificationSource}>
              {(notificationSource) => (
                <DocumentDebouncedNotificationReadMarker
                  notificationSource={notificationSource()}
                  documentId={documentId}
                />
              )}
            </Show>
            <div
              class="w-full grow overflow-hidden relative"
              data-block-content
            >
              <Scroll class="relative" scrollRef={setScrollRef}>
                <div class="relative portal-scope touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                  <Suspense>
                    <Show
                      when={!markdownDocument.isInstructions()}
                      fallback={
                        <InstructionsNotebook loroManager={loroManager} />
                      }
                    >
                      <Notebook
                        loroManager={loroManager}
                        documentId={documentId}
                      />
                    </Show>
                  </Suspense>
                </div>
              </Scroll>
            </div>
          </div>
        </SidePanel.Layout>
      </HistoryProvider>
    </div>
  );
}
