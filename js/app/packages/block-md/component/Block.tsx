import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { SidePanel } from '@app/component/side-panel';
import { useBlockId } from '@core/block';
import { createLoroManager } from '@core/collab/manager';
import type { InitialSync, TimeoutError } from '@core/collab/source';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { blockErrorSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { MARKDOWN_LORO_SCHEMA } from '@lexical-core/markdown-loro-schema';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { Scroll } from '@ui';
import type { Result } from 'neverthrow';
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
        setBlockError('MISSING');
        return;
      } else {
        setBlockError(null);
      }

      if (optimisticSnapshot) {
        loroManager.initializeFromSnapshot(optimisticSnapshot).then(() => {
          data
            .doInitialSync()
            .then((syncResult: Result<InitialSync, TimeoutError>) => {
              if (syncResult.isErr()) {
                console.error(
                  'Failed to receive initial sync',
                  syncResult.error
                );
                setBlockError('INVALID');
                return;
              }
              const peerId = loroManager.getPeerId();
              data.syncSource.pushUpdate(
                loroManager.getDoc().export({ mode: 'update' }),
                peerId
              );
            });
        });
      } else {
        data
          .doInitialSync()
          .then((syncResult: Result<InitialSync, TimeoutError>) => {
            if (syncResult.isErr()) {
              console.error('Failed to receive initial sync', syncResult.error);
              setBlockError('INVALID');
              return;
            }
            loroManager
              .initializeFromSnapshot(syncResult.value.snapshot)
              .then((result) => {
                if (result.isErr()) {
                  console.error('Failed to initialize loro doc', result.error);
                  setBlockError('INVALID');
                }
              });
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
                {/* off until - https://linear.app/macro-eng/issue/M-5203/markdown-unloads-completely-after-find */}
                <Suspense>
                  <Show when={!isInstructionsMd() && false}>
                    <div class="absolute right-4 bottom-[-12] translate-y-full z-action-menu flex justify-end">
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
