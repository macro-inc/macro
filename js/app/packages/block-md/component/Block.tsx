import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { SidePanel } from '@app/component/side-panel';
import { useBlockId } from '@core/block';
import { createLoroManager, type LoroManager } from '@core/collab/manager';
import type { RawUpdate } from '@core/collab/shared';
import {
  IDBSnapshotStore,
  LORO_SNAPSHOT_DB_NAME,
} from '@core/collab/snapshot-store';
import { BrowserWALStore, LORO_WAL_DB_NAME } from '@core/collab/wal';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { blockErrorSignal, blockSyncSourceSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { MARKDOWN_LORO_SCHEMA } from '@lexical-core/markdown-loro-schema';
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

async function ingestLocalSnapshot(
  loroManager: MarkdownLoroManager,
  snapshotStore: IDBSnapshotStore<RawUpdate>,
  walStore: BrowserWALStore<RawUpdate>
) {
  const localSnapshot = await snapshotStore.load();
  if (!localSnapshot) return;
  const walEntries = await walStore.getAll();
  await loroManager.ingest({
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
    const doc = loroManager.getDoc();
    const snapshot = doc.export({
      mode: 'shallow-snapshot',
      frontiers: doc.oplogFrontiers(),
    });
    await snapshotStore.save(snapshot);
  }
}

async function ingestRemoteSnapshot(
  loroManager: MarkdownLoroManager,
  doInitialSync: MarkdownData['doInitialSync']
): Promise<boolean> {
  const sync = await doInitialSync();
  if (sync.isErr()) {
    console.error('Failed to receive initial sync', sync.error);
    return loroManager.isInitialized();
  }
  await loroManager.ingest({
    kind: 'dss',
    snapshot: sync.value.snapshot,
  });
  return true;
}

async function ingestS3Snapshot(
  loroManager: MarkdownLoroManager,
  blockId: string
) {
  const result = await storageServiceClient.fetchCachedSnapshot(blockId);
  if (result.isOk()) {
    await loroManager.ingest({ kind: 's3', snapshot: result.value });
  }
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

  const getSyncSource = blockSyncSourceSignal.get;
  const setBlockError = blockErrorSignal.set;

  const wasDirty = BrowserWALStore.isDirtyHint(LORO_WAL_DB_NAME, blockId);
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, {
    liveSyncSource: () => getSyncSource()!,
    wasDirty,
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

      // Fan out — the state machine in LoroManager handles precedence
      // and rejects events that don't apply for the current `wasDirty` mode.
      if (optimisticSnapshot) {
        loroManager.ingest({
          kind: 'optimistic',
          snapshot: optimisticSnapshot,
        });
      }

      // unawaited — state machine handles precedence
      ingestLocalSnapshot(loroManager, snapshotStore, walStore);
      ingestS3Snapshot(loroManager, blockId);
      ingestRemoteSnapshot(loroManager, data.doInitialSync);
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
                <Scroll class="relative" ref={setScrollRef}>
                  <div class="relative portal-scope">
                    <Suspense>
                      <Show
                        when={!isInstructionsMd()}
                        fallback={
                          <InstructionsNotebook loroManager={loroManager} />
                        }
                      >
                        <Notebook loroManager={loroManager} />
                      </Show>
                    </Suspense>
                  </div>
                </Scroll>
              </div>
            </div>
          </SidePanel.Layout>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}
