import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { withAnalytics } from '@coparse/analytics';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { CustomScrollbar } from '../../macro-entity/src/components/CustomScrollbar';
import { DocumentDebouncedNotificationReadMarker } from '@notifications';
import { useInstructionsMdIdQuery } from '@service-storage/instructionsMd';
import { createEffect, createSignal, onMount, Show } from 'solid-js';
import { mdStore } from '../signal/markdownBlockData';
import { FindAndReplace } from './FindAndReplace';
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
      <div
        class="w-full h-full select-none overscroll-none overflow-hidden flex flex-col relative bracket-never"
        tabIndex={-1}
      >
        <div class="relative">
          <Show when={!isInstructionsMd()} fallback={<InstructionsTopBar />}>
            <TopBar />
          </Show>
          {/* off until - https://linear.app/macro-eng/issue/M-5203/markdown-unloads-completely-after-find */}
          <Show when={!isInstructionsMd() && false}>
            <div class="absolute right-4 bottom-[-12] translate-y-full z-action-menu flex justify-end">
              <FindAndReplace />
            </div>
          </Show>
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
            <Show
              when={!isInstructionsMd()}
              fallback={<InstructionsNotebook />}
            >
              <Notebook />
            </Show>
          </div>
          <CustomScrollbar scrollContainer={scrollRef} />
        </div>
      </div>
    </DocumentBlockContainer>
  );
}
