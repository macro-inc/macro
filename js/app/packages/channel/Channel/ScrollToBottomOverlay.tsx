import { Show, type Accessor } from 'solid-js';
import type { ThreadListNavigation, ThreadListScrollState } from './ThreadList';

export function shouldShowScrollToBottomButton(
  state: ThreadListScrollState | undefined
): boolean {
  if (!state) return false;
  return (
    state.didInitialScroll &&
    !state.isNearBottom &&
    state.isScrollingDown &&
    state.distanceFromBottom > state.viewportSize
  );
}

type ScrollToBottomOverlayProps = {
  navigation: Accessor<ThreadListNavigation | undefined>;
  scrollState: Accessor<ThreadListScrollState | undefined>;
  class?: string;
};

export function ScrollToBottomOverlay(props: ScrollToBottomOverlayProps) {
  return (
    <Show when={shouldShowScrollToBottomButton(props.scrollState())}>
      <button
        type="button"
        class={`absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 text-xs bg-menu border border-edge-muted hover:bg-hover hover-transition-bg ${props.class ?? ''}`}
        onClick={() => {
          props.navigation()?.scrollToBottom('end');
        }}
      >
        Scroll to bottom
      </button>
    </Show>
  );
}
