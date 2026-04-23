import { Show, type Accessor } from 'solid-js';
import { cn } from '@ui/utils/classname';
import type { ThreadListScrollState } from './ThreadList';

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
  scrollState: Accessor<ThreadListScrollState | undefined>;
  onScrollToBottom: () => void;
  class?: string;
};

export function ScrollToBottomOverlay(props: ScrollToBottomOverlayProps) {
  return (
    <Show when={shouldShowScrollToBottomButton(props.scrollState())}>
      <button
        type="button"
        class={cn(
          'absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 text-xs bg-menu border border-edge-muted hover:bg-hover hover-transition-bg',
          props.class
        )}
        onClick={() => {
          props.onScrollToBottom();
        }}
      >
        Scroll to bottom
      </button>
    </Show>
  );
}
