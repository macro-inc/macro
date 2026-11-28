import { isEditableInput } from '@core/util/isEditableInput';
import { createScrollIntentTracker } from '@core/util/scroll-intent';
import { createStore } from 'solid-js/store';

type ScrollPane = 'overview' | 'changes';

export function scrollChromeCompensation(
  expanded: number,
  compact: number,
  topBarFull: number,
  topBarCurrent: number,
  scrolled: boolean
) {
  return Math.max(
    0,
    (scrolled ? expanded - compact : 0) + topBarFull - topBarCurrent
  );
}

/** Chrome follows actual user movement, not anchoring or nested editor scrolling. */
export function createScrollHideReveal() {
  const awaitingInput: Record<ScrollPane, boolean> = {
    overview: false,
    changes: false,
  };
  const previousTop: Record<ScrollPane, number> = { overview: 0, changes: 0 };
  const [state, setState] = createStore({
    scrolled: false,
    topBarVisible: true,
  });
  let distance = 0;
  let direction: 'up' | 'down' | undefined;
  const track = (pane: ScrollPane) =>
    createScrollIntentTracker(() => {
      awaitingInput[pane] = false;
      // A pane that fits after collapse cannot emit another scroll event at zero.
      if (previousTop[pane] === 0 && intents[pane].lastDirection() === 'up') {
        setState({ scrolled: false, topBarVisible: true });
        distance = 0;
        direction = undefined;
        awaitingInput[pane] = true;
      }
    });
  const intents: Record<
    ScrollPane,
    ReturnType<typeof createScrollIntentTracker>
  > = { overview: track('overview'), changes: track('changes') };
  const handlers = (
    pane: ScrollPane
  ): ReturnType<typeof createScrollIntentTracker>['handlers'] => ({
    ...intents[pane].handlers,
    onKeyDown: (event) => {
      if (isEditableInput(event.target)) return;
      const handler = intents[pane].handlers.onKeyDown;
      if (typeof handler === 'function') handler(event);
      else handler[0](handler[1], event);
    },
  });
  const onScroll = (pane: ScrollPane, top: number) => {
    const delta = top - previousTop[pane];
    previousTop[pane] = top;
    const intent = intents[pane];
    if (awaitingInput[pane] || !intent.isUserInteracting() || delta === 0)
      return;
    intent.observeScroll();
    const scrolled = top >= 146;
    if (state.scrolled !== scrolled) {
      setState('scrolled', scrolled);
      awaitingInput[pane] = true;
    }
    if (!scrolled) {
      distance = 0;
      direction = undefined;
      setState('topBarVisible', true);
      return;
    }
    const nextDirection = delta > 0 ? 'down' : 'up';
    distance =
      direction === nextDirection
        ? distance + Math.abs(delta)
        : Math.abs(delta);
    direction = nextDirection;
    if (distance < 8) return;
    if (state.topBarVisible !== (direction === 'up')) {
      setState('topBarVisible', direction === 'up');
      awaitingInput[pane] = true;
    }
    distance = 0;
  };
  return {
    scrolled: () => state.scrolled,
    topBarVisible: () => state.topBarVisible,
    onScroll,
    handlers,
    intent: (pane: ScrollPane) => intents[pane],
  };
}
