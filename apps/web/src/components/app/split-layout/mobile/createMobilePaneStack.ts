import { createComputed, on } from 'solid-js';
import type { SplitId, SplitManager } from '../layoutManager';

/**
 * Stacked panes on mobile: the front pane shows, and the one behind stays
 * mounted so swiping back can reveal it. Back always closes the front pane.
 */
export type MobilePaneStack = {
  front: () => SplitId | undefined;
  behind: () => SplitId | undefined;
  canGoBack: () => boolean;
  /** Closes the front pane, animated once the container registers a trigger. */
  goBack: () => void;
  /** Closes the front pane now; the container calls it when its swipe finishes. */
  completeGoBack: () => void;
  setAnimatedTrigger: (trigger: (() => void) | undefined) => void;
  /** Runs when another pane comes to the front ahead of `from`, the old front, so the container can slide it in. */
  setForwardTrigger: (trigger: ((from: SplitId) => void) | undefined) => void;
};

export function createMobilePaneStack(
  splitManager: Pick<SplitManager, 'splits' | 'getSplit'>
): MobilePaneStack {
  const ids = () => splitManager.splits().map(({ id }) => id);
  const front = () => ids().at(-1);
  const behind = () => ids().at(-2);
  const canGoBack = () => ids().length > 1;

  let animatedTrigger: (() => void) | undefined;
  let forwardTrigger: ((from: SplitId) => void) | undefined;

  createComputed(
    on(ids, (next, previous) => {
      const before = previous?.at(-1);
      if (!before) return;

      const covered = next.at(-1) !== before && next.includes(before);
      if (covered) forwardTrigger?.(before);
    })
  );

  function completeGoBack() {
    const id = front();
    if (!id || !canGoBack()) return;

    splitManager.getSplit(id)?.close();
  }

  function goBack() {
    if (!canGoBack()) return;
    if (animatedTrigger) {
      animatedTrigger();
      return;
    }

    completeGoBack();
  }

  return {
    front,
    behind,
    canGoBack,
    goBack,
    completeGoBack,
    setAnimatedTrigger: (trigger) => {
      animatedTrigger = trigger;
    },
    setForwardTrigger: (trigger) => {
      forwardTrigger = trigger;
    },
  };
}
