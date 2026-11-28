import { isEditableInput } from '@core/util/isEditableInput';
import { createScrollIntentTracker } from '@core/util/scroll-intent';
import { createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';

type ScrollPane = 'overview' | 'changes';
type ChromeState = {
  scrolled: boolean;
  topBarVisible: boolean;
  revision: number;
};

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

/** Each pane retains its own chrome; only user movement animates a height change. */
export function createScrollHideReveal(activePane: () => ScrollPane) {
  const awaitingInput: Record<ScrollPane, boolean> = {
    overview: false,
    changes: false,
  };
  const previousTop: Record<ScrollPane, number> = { overview: 0, changes: 0 };
  const distance: Record<ScrollPane, number> = { overview: 0, changes: 0 };
  const direction: Record<ScrollPane, 'up' | 'down' | undefined> = {
    overview: undefined,
    changes: undefined,
  };
  const [state, setState] = createStore<Record<ScrollPane, ChromeState>>({
    overview: { scrolled: false, topBarVisible: true, revision: 0 },
    changes: { scrolled: false, topBarVisible: true, revision: 0 },
  });
  const updateChrome = (
    pane: ScrollPane,
    patch: Partial<Omit<ChromeState, 'revision'>>
  ) => {
    const current = state[pane];
    const scrolled = patch.scrolled ?? current.scrolled;
    const topBarVisible = patch.topBarVisible ?? current.topBarVisible;
    if (
      scrolled === current.scrolled &&
      topBarVisible === current.topBarVisible
    )
      return;
    setState(pane, { scrolled, topBarVisible, revision: current.revision + 1 });
  };
  const motion = createMemo<{
    pane: ScrollPane;
    revision: number;
    animate: boolean;
  }>((previous) => {
    const pane = activePane();
    const revision = state[pane].revision;
    if (previous?.pane !== pane) return { pane, revision, animate: false };
    if (previous.revision === revision) return previous;
    return { pane, revision, animate: true };
  });
  const track = (pane: ScrollPane) =>
    createScrollIntentTracker(() => {
      awaitingInput[pane] = false;
      // A pane that fits after collapse cannot emit another scroll event at zero.
      if (previousTop[pane] === 0 && intents[pane].lastDirection() === 'up') {
        updateChrome(pane, { scrolled: false, topBarVisible: true });
        distance[pane] = 0;
        direction[pane] = undefined;
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
    if (state[pane].scrolled !== scrolled) {
      updateChrome(pane, { scrolled });
      awaitingInput[pane] = true;
    }
    if (!scrolled) {
      distance[pane] = 0;
      direction[pane] = undefined;
      updateChrome(pane, { topBarVisible: true });
      return;
    }
    const nextDirection = delta > 0 ? 'down' : 'up';
    distance[pane] =
      direction[pane] === nextDirection
        ? distance[pane] + Math.abs(delta)
        : Math.abs(delta);
    direction[pane] = nextDirection;
    if (distance[pane] < 8) return;
    if (state[pane].topBarVisible !== (nextDirection === 'up')) {
      updateChrome(pane, { topBarVisible: nextDirection === 'up' });
      awaitingInput[pane] = true;
    }
    distance[pane] = 0;
  };
  return {
    scrolled: (pane: ScrollPane = activePane()) => state[pane].scrolled,
    topBarVisible: (pane: ScrollPane = activePane()) =>
      state[pane].topBarVisible,
    animate: () => motion().animate,
    onScroll,
    handlers,
    intent: (pane: ScrollPane) => intents[pane],
  };
}
