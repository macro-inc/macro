import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { MobileDockButton } from '@components/app/mobile/MobileDockButton';
import { MobileDockIsland } from '@components/app/mobile/MobileDockIsland';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowDown from '@phosphor-icons/core/regular/arrow-down.svg?component-solid';
import { Layer } from '@ui';
import { type Accessor, Show } from 'solid-js';
import type { ThreadListScrollState } from './ThreadList';

export function shouldShowScrollToBottomButton(
  state: ThreadListScrollState | undefined,
  touch: boolean
): boolean {
  if (!state?.didInitialScroll || state.isNearBottom) return false;
  return (
    touch ||
    (state.isScrollingDown && state.distanceFromBottom > state.viewportSize)
  );
}

type ScrollToBottomOverlayProps = {
  scrollState: Accessor<ThreadListScrollState | undefined>;
  onScrollToBottom: (behavior?: ScrollBehavior) => void;
};

export function ScrollToBottomOverlay(props: ScrollToBottomOverlayProps) {
  return (
    <Show
      when={shouldShowScrollToBottomButton(
        props.scrollState(),
        isTouchDevice()
      )}
    >
      <Layer depth={3}>
        <Show
          when={isTouchDevice()}
          fallback={
            <button
              type="button"
              class="absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-full px-3 py-1.5 text-xs bg-surface border border-edge-muted shadow-lg not-touch:hover:overlay-hover not-touch:active:overlay-active"
              onClick={() => {
                props.onScrollToBottom();
              }}
            >
              Scroll to bottom
            </button>
          }
        >
          <MobileDockIsland
            class="absolute z-10 right-[calc(var(--safe-right,0px)+var(--mobile-chrome-gutter))]"
            style={{ bottom: `${FloatRegions.hostHeight() + 12}px` }}
          >
            <MobileDockButton
              icon={ArrowDown}
              ariaLabel="Jump to latest"
              data-keep-keyboard
              onClick={() => props.onScrollToBottom('smooth')}
            />
          </MobileDockIsland>
        </Show>
      </Layer>
    </Show>
  );
}
