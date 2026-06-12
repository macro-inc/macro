import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { SidePanel } from '@app/component/side-panel';
import { useBlockId } from '@core/block';
import { createLoroManager, type LoroManager } from '@core/collab/manager';
import type { InitialSync, TimeoutError } from '@core/collab/source';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { blockErrorSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import {
  MARKDOWN_LORO_SCHEMA,
  type MarkdownLoroSchemaType,
} from '@lexical-core/markdown-loro-schema';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { storageServiceClient } from '@service-storage/client';
import { Scroll } from '@ui';
import { err, ok, type Result } from 'neverthrow';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  Show,
  Suspense,
} from 'solid-js';
import { blockDataSignal, mdStore } from '../signal/markdownBlockData';
import { FindAndReplace } from './FindAndReplace';
import { MarkdownNameProvider, useMarkdownName } from './MarkdownNameProvider';
import { ModalsProvider } from './ModalsProvider';
import { InstructionsNotebook, Notebook } from './Notebook';
import { MarkdownSidePanelSections } from './sidepanel/MarkdownSidePanelSections';
import { InstructionsTopBar, TopBar } from './TopBar';

export interface BlockMarkdownProps {
  /**
   * A loro snapshot to load while we wait for the real one to come through from
   * the DO. We push our changes after we the DO one comes in.
   */
  optimisticSnapshot?: Uint8Array<ArrayBufferLike>;
}

type SyncError = 'UNAUTHORIZED' | 'INVALID' | 'GONE';

type BlockData = NonNullable<ReturnType<typeof blockDataSignal>>;

async function syncFromOptimistic({
  data,
  loroManager,
  optimisticSnapshot,
}: {
  data: BlockData;
  loroManager: LoroManager<MarkdownLoroSchemaType>;
  optimisticSnapshot: Uint8Array<ArrayBufferLike>;
}): Promise<Result<void, SyncError>> {
  await loroManager.initializeFromSnapshot(optimisticSnapshot);

  const syncResult: Result<InitialSync, TimeoutError> =
    await data.doInitialSync();

  if (syncResult.isErr()) {
    console.error('Failed to receive initial sync', syncResult.error);
    return err('INVALID');
  }

  data.syncSource.pushUpdate(
    loroManager.getDoc().export({ mode: 'update' }),
    loroManager.getPeerId()
  );

  return ok();
}

async function syncFromDO({
  data,
  loroManager,
  blockId,
}: {
  data: BlockData;
  loroManager: LoroManager<MarkdownLoroSchemaType>;
  blockId: string;
}): Promise<Result<void, SyncError>> {
  let gotDoSnapshot = false;

  // unawaited: only use S3 snapshot if DO hasn't responded first
  // NOTE: gotDoSnapshot flips to true when DO snapshot is used, and it may
  // happen WHILE we are fetching a cached snapshot THEORETICALLY
  (async () => {
    try {
      const result = await storageServiceClient.fetchCachedSnapshot(blockId);
      if (!gotDoSnapshot && result.isOk()) {
        await loroManager.initializeFromSnapshot(result.value);
      }
    } catch (error) {
      console.warn('Failed to load cached snapshot', error);
    }
  })();

  try {
    const syncResult: Result<InitialSync, TimeoutError> =
      await data.doInitialSync();

    if (syncResult.isErr()) {
      console.error('Failed to receive initial sync', syncResult.error);
      return err('INVALID');
    }

    const result = await loroManager.initializeFromSnapshot(
      syncResult.value.snapshot
    );

    gotDoSnapshot = true;

    if (result.isErr()) {
      console.error('Failed to initialize loro doc', result.error);
      return err('INVALID');
    }
  } catch (error) {
    console.error('Failed to sync from DO', error);
    return err('INVALID');
  }

  return ok();
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
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA);

  const setBlockError = blockErrorSignal.set;

  createEffect(
    on(blockDataSignal, (data) => {
      if (!data) {
        // TODO: if it's actually missing what do we do?
        // setBlockError('MISSING');
        return;
      } else {
        setBlockError(null);
      }
      if (optimisticSnapshot) {
        // unawaited
        syncFromOptimistic({ data, loroManager, optimisticSnapshot }).then(
          (r) => {
            if (r.isErr()) setBlockError(r.error);
          }
        );
      } else {
        // unawaited
        syncFromDO({ data, loroManager, blockId }).then((r) => {
          if (r.isErr()) setBlockError(r.error);
        });
      }
    })
  );

  const instructionsMdId = useInstructionsMdIdQuery();
  const notificationSource = useGlobalNotificationSource();
  const mustBeConnected = optimisticSnapshot === undefined;
  const canEdit = useCanEdit(mustBeConnected);
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
                          <InstructionsNotebook
                            loroManager={() => loroManager}
                          />
                        }
                      >
                        <Notebook
                          loroManager={() => loroManager}
                          mustBeConnected={mustBeConnected}
                        />
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
