import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { withAnalytics } from '@coparse/analytics';
import { useBlockId } from '@core/block';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { createEffect, createSignal, onMount, Show, Suspense } from 'solid-js';
import { mdStore } from '../signal/markdownBlockData';
import { FindAndReplace } from './FindAndReplace';
import { ModalsProvider } from './ModalsProvider';
import { InstructionsNotebook, Notebook } from './Notebook';
import { InstructionsTopBar, TopBar } from './TopBar';

const { track, TrackingEvents } = withAnalytics();

export default function BlockMarkdown() {
  const [scrollRef, setScrollRef] = createSignal<HTMLDivElement>();
  const blockId = useBlockId();
  const instructionsMdId = useInstructionsMdIdQuery();
  const notificationSource = useGlobalNotificationSource();
  const isInstructionsMd = () => {
    return blockId === instructionsMdId.data;
  };

  // Set initial data.
  onMount(() => {
    track(TrackingEvents.BLOCKMARKDOWN.OPEN);
  });

  createEffect(() => {
    const el = scrollRef();
    if (el) {
      mdStore.set({ scrollContainer: el });
    }
  });

  return (
    <DocumentBlockContainer>
      <ModalsProvider>
        <div
          class="w-full h-full select-none overscroll-none overflow-hidden flex flex-col relative bracket-never"
          tabIndex={-1}
        >
          <div class="relative">
            <Suspense>
              <Show
                when={!isInstructionsMd()}
                fallback={<InstructionsTopBar />}
              >
                <TopBar />
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
          <div class="w-full grow overflow-hidden relative" data-block-content>
            <div
              class="w-full h-full relative overflow-auto portal-scope scrollbar-hidden"
              ref={setScrollRef}
            >
              <Suspense>
                <Show
                  when={!isInstructionsMd()}
                  fallback={<InstructionsNotebook />}
                >
                  <Notebook />
                </Show>
              </Suspense>
            </div>
            <CustomScrollbar scrollContainer={scrollRef} />
          </div>
        </div>
      </ModalsProvider>
    </DocumentBlockContainer>
  );
}
