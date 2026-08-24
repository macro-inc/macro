import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { blockErrorSignal, blockSyncSourceSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
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
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { storageServiceClient } from '@service-storage/client';
import { Scroll } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
  Suspense,
} from 'solid-js';
import type { MarkdownData } from '../definition';
import { HistoryProvider } from '../history/HistoryContext';
import { OldOverlay } from '../history/OldOverlay';
import { resumeDocumentSpan, stampLoroSnapshotState } from '../observability';
import { blockDataSignal, mdStore } from '../signal/markdownBlockData';
import { FindAndReplace } from './FindAndReplace';
import { MarkdownNameProvider, useMarkdownName } from './MarkdownNameProvider';
import { ModalsProvider } from './ModalsProvider';
import { InstructionsNotebook, Notebook } from './Notebook';
import { MarkdownSidePanelSections } from './sidepanel/MarkdownSidePanelSections';
import { InstructionsTopBar, TopBar } from './TopBar';

export interface BlockMarkdownProps {
  /**
   * A loro snapshot to load while we wait for a remote snapshot (from s3, dss, etc.).
   */
  optimisticSnapshot?: Uint8Array<ArrayBufferLike>;
}

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

  void operation
    .then(({ outcome, bytes }) => {
      parentSpan?.event('doc.snapshot.result', {
        'snapshot.source': source,
        ...(bytes !== undefined && { 'snapshot.bytes': bytes }),
        outcome,
      });
    })
    .catch(() => {
      parentSpan?.event('doc.snapshot.result', {
        'snapshot.source': source,
        outcome: 'error',
      });
    });
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

  // Fold the replayed WAL edits into a fresh local snapshot so they don't have
  // to be replayed on the next cold load. This is for a race condition where
  // we recover from a snapshot and replay WAL logs, deleting the WAL logs as
  // we replay, and then reload, and now we are in a state where we have an old
  // document until the new one loads in
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

/**
 * Ingest the sync-service initial sync. `discarded` means the snapshot
 * arrived fine but lost the seed race.
 */
async function ingestRemoteSnapshot(
  loroManager: MarkdownLoroManager,
  doInitialSync: MarkdownData['doInitialSync']
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
  blockId: string
): Promise<SnapshotResult> {
  const result = await storageServiceClient.fetchCachedSnapshot(blockId);
  if (result.isErr()) return { outcome: 'unavailable' };
  const seeded = await loroManager.ingest({
    kind: 's3',
    snapshot: result.value,
  });
  return {
    outcome: seeded ? 'seeded' : 'discarded',
    bytes: result.value.length,
  };
}

export default function BlockMarkdown(props: BlockMarkdownProps) {
  return (
    <MarkdownNameProvider>
      <BlockMarkdownContent {...props} />
    </MarkdownNameProvider>
  );
}

function BlockMarkdownContent({ optimisticSnapshot }: BlockMarkdownProps) {
  useBlockEntityCommands();
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();
  const blockId = useBlockId();

  const _getSyncSource = blockSyncSourceSignal.get;
  const setBlockError = blockErrorSignal.set;

  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: blockId,
  });

  const snapshotStore = new IDBSnapshotStore<RawUpdate>(
    LORO_SNAPSHOT_DB_NAME,
    blockId
  );
  const walStore = new BrowserWALStore<RawUpdate>(LORO_WAL_DB_NAME, blockId);

  createEffect(
    on(blockDataSignal, (data) => {
      if (!data) {
        // TODO: if it's actually missing what do we do?
        // setBlockError('MISSING');
        return;
      }
      setBlockError(null);

      // optimistic is the "hard coded" snapshot like the golden one when you create a
      // new document
      const span = resumeDocumentSpan(blockId);
      if (optimisticSnapshot) {
        startSnapshotIngest(span, 'optimistic', loroManager, async () => {
          const seeded = await loroManager.ingest({
            kind: 'optimistic',
            snapshot: optimisticSnapshot,
          });
          return {
            outcome: seeded ? 'seeded' : 'discarded',
            bytes: optimisticSnapshot.length,
          };
        });
      }

      // First one wins automatically (loro manager takes care of ignoring the rest)
      startSnapshotIngest(span, 'local', loroManager, () =>
        ingestLocalSnapshot(loroManager, snapshotStore, walStore)
      );
      startSnapshotIngest(span, 's3', loroManager, () =>
        ingestS3Snapshot(loroManager, blockId)
      );
      startSnapshotIngest(span, 'remote', loroManager, () =>
        ingestRemoteSnapshot(loroManager, data.doInitialSync)
      );
    })
  );

  const instructionsMdId = useInstructionsMdIdQuery();
  const notificationSource = useGlobalNotificationSource();
  const canEdit = useCanEdit();
  const { displayName } = useMarkdownName();
  const isInstructionsMd = createMemo(() => blockId === instructionsMdId.data);

  createEffect(() => {
    const el = scrollRef();
    if (el) {
      mdStore.set({ scrollContainer: el });
    }
  });

  return (
    <DocumentBlockContainer>
      <div
        class="size-full select-none overscroll-none overflow-hidden flex flex-col relative"
        tabIndex={-1}
      >
        <ModalsProvider>
          <HistoryProvider documentId={() => blockId}>
            <OldOverlay />
            <SidePanel.Layout>
              <Show when={ENABLE_MARKDOWN_SIDE_PANEL && !isInstructionsMd()}>
                <MarkdownSidePanelSections
                  canEdit={canEdit()}
                  documentName={displayName() ?? ''}
                />
              </Show>
              <div class="flex flex-col size-full">
                <div class="relative shrink-0">
                  <Suspense>
                    <Show
                      when={!isInstructionsMd()}
                      fallback={<InstructionsTopBar />}
                    >
                      <TopBar name={displayName} />
                    </Show>
                  </Suspense>
                  <Suspense>
                    <Show when={!isInstructionsMd()}>
                      <div class="absolute right-4 top-1.5 z-action-menu flex justify-end">
                        <FindAndReplace />
                      </div>
                    </Show>
                  </Suspense>
                </div>
                <DocumentDebouncedNotificationReadMarker
                  notificationSource={notificationSource}
                  documentId={blockId}
                />
                <div
                  class="w-full grow overflow-hidden relative"
                  data-block-content
                >
                  <Scroll class="relative" scrollRef={setScrollRef}>
                    <div class="relative portal-scope touch:pt-(--mobile-content-inset-top) touch:pb-(--mobile-content-inset-bottom)">
                      <Suspense>
                        <Show
                          when={!isInstructionsMd()}
                          fallback={
                            <InstructionsNotebook loroManager={loroManager} />
                          }
                        >
                          <Notebook
                            loroManager={loroManager}
                            documentId={blockId}
                          />
                        </Show>
                      </Suspense>
                    </div>
                  </Scroll>
                </div>
              </div>
            </SidePanel.Layout>
          </HistoryProvider>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}
