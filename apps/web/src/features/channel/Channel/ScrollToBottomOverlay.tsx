import { cn, Layer } from '@ui';
import { type Accessor, Show } from 'solid-js';
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
      <Layer depth={3}>
        <button
          type="button"
          class={cn(
            'absolute top-4 left-1/2 -translate-x-1/2 z-10 rounded-full px-3 py-1.5 text-xs bg-surface border border-edge-muted shadow-lg not-touch:hover:overlay-hover not-touch:active:overlay-active',
            props.class
          )}
          onClick={() => {
            props.onScrollToBottom();
          }}
        >
          Scroll to bottom
        </button>
      </Layer>
    </Show>
  );
}
