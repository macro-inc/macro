import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { Keyboard } from '@capacitor/keyboard';
import { withAnalytics } from '@coparse/analytics';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { DocumentDebouncedNotificationReadMarker } from '@notifications/components/DebouncedNotificationReadMarker';
import { useInstructionsMdIdQuery } from '@service-storage/instructionsMd';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
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

  if (isNativeMobilePlatform()) {
    // temporary fix for mobile
    onMount(() => Keyboard.setAccessoryBarVisible({ isVisible: true }));
    onCleanup(() => Keyboard.setAccessoryBarVisible({ isVisible: false }));
  }

  createEffect(() => {
    const el = scrollRef();
    if (el) {
      mdStore.set({ scrollContainer: el });
    }
  });

  return (
    <DocumentBlockContainer>
      <div class="w-full h-full select-none overscroll-none overflow-hidden flex flex-col relative">
        <div class="relative">
          <Show when={!isInstructionsMd()} fallback={<InstructionsTopBar />}>
            <TopBar />
          </Show>
          <Show when={!isInstructionsMd()}>
            <div class="absolute right-4 bottom-[-12] translate-y-full z-action-menu flex justify-end">
              <FindAndReplace />
            </div>
          </Show>
        </div>
        <DocumentDebouncedNotificationReadMarker
          notificationSource={notificationSource}
          documentId={blockId}
        />
        <div class="w-full grow overflow-hidden" data-block-content>
          <div
            class="w-full h-full relative overflow-auto portal-scope"
            ref={setScrollRef}
            style={{
              'scrollbar-gutter': 'stable',
            }}
          >
            <Show
              when={!isInstructionsMd()}
              fallback={<InstructionsNotebook />}
            >
              <Notebook />
            </Show>
          </div>
        </div>
      </div>
    </DocumentBlockContainer>
  );
}
