import { batch, createSignal, onCleanup } from 'solid-js';
import type {
  OpenWithSplitOptions,
  ReferredFrom,
  SplitContent,
  SplitId,
  SplitManager,
} from '../layoutManager';

export type MobileSwipeLayout = {
  /** Split ID currently in slot A (may be FG or BG depending on fgIsSlotA). */
  slotASplitId: () => SplitId | undefined;
  /** Split ID currently in slot B (may be FG or BG depending on fgIsSlotA). */
  slotBSplitId: () => SplitId | undefined;
  /** True when slot A is the foreground; false when slot B is the foreground. */
  fgIsSlotA: () => boolean;
  /** True when a background split is available to swipe back to. */
  canGoBack: () => boolean;
  /**
   * Completes a swipe-back. Flips the FG/BG role so the current BG slot becomes FG
   * (no remount for the promoted panel), destroys the old FG, and lazily mounts a
   * new BG from the promoted split's history into the old FG slot.
   * Called by MobileSwipeBackContainer after its animation finishes.
   */
  completeSwipeBack: () => void;
  /** Completes a prepared forward navigation after the swipe-in animation. */
  completeNavigateForward: () => void;
  /**
   * Register an animated trigger provided by MobileSwipeBackContainer.
   * When set, swipeBack() will animate before completing.
   */
  setAnimatedTrigger: (trigger: (() => void) | undefined) => void;
  /**
   * Register an animated forward-navigation trigger. The next split is already
   * prepared in the background slot when this trigger runs.
   */
  setForwardNavigationTrigger: (trigger: (() => void) | undefined) => void;
  /**
   * Initiate a swipe-back — animated if container has registered a trigger,
   * otherwise completes immediately. Called by the split header back button.
   */
  swipeBack: () => void;
};

export function createMobileSwipeLayout(
  splitManager: SplitManager
): MobileSwipeLayout {
  // Initialise slot A to whatever the first (only) split is on mobile load.
  const initialFgId = splitManager.splits()[0]?.id;

  const [slotASplitId, setSlotASplitId] = createSignal<SplitId | undefined>(
    initialFgId
  );
  const [slotBSplitId, setSlotBSplitId] = createSignal<SplitId | undefined>(
    undefined
  );
  /** When true, slot A is foreground; when false, slot B is foreground. */
  const [fgIsSlotA, setFgIsSlotA] = createSignal(true);
  const toggleFgSlot = () => setFgIsSlotA((prev) => !prev);

  let animatedTrigger: (() => void) | undefined;
  let forwardNavigationTrigger: (() => void) | undefined;

  const fgSplitId = () => (fgIsSlotA() ? slotASplitId() : slotBSplitId());
  const bgSplitId = () => (fgIsSlotA() ? slotBSplitId() : slotASplitId());
  const sameContent = (a: SplitContent, b: SplitContent) =>
    a.type === b.type && a.id === b.id;

  // The BG split is always exactly bgSplitId() — derive exclusion directly from
  // the slot signals rather than maintaining a separate set.
  splitManager.setExclusionFilter((split) => split.id === bgSplitId());
  splitManager.setNavigationInterceptor((content, options) => {
    if (options.mergeHistory) return { handled: false };
    navigateForward(content, options);
    return { handled: true };
  });
  onCleanup(() => {
    splitManager.setExclusionFilter(undefined);
    splitManager.setNavigationInterceptor(undefined);
  });

  function canGoBack() {
    const bgId = bgSplitId();
    return bgId !== undefined && splitManager.getSplit(bgId) !== undefined;
  }

  function navigateForward(
    content: SplitContent,
    options?: Pick<OpenWithSplitOptions, 'referredFrom'>
  ) {
    const isFgA = fgIsSlotA();
    const currentFgId = fgSplitId();
    const currentBgId = bgSplitId();
    // New FG content goes into the old BG slot (it becomes FG after the swap).
    const setNewFgSlotId = isFgA ? setSlotBSplitId : setSlotASplitId;
    const referredFrom: ReferredFrom = options?.referredFrom ?? null;

    const fgHandle = currentFgId
      ? splitManager.getSplit(currentFgId)
      : undefined;
    const bgHandle = currentBgId
      ? splitManager.getSplit(currentBgId)
      : undefined;

    // If the target is already mounted in BG, promote it instead of recreating it.
    if (bgHandle && sameContent(bgHandle.content(), content)) {
      if (forwardNavigationTrigger) {
        forwardNavigationTrigger();
      } else {
        completeNavigateForward();
      }
      return;
    }

    const newFgInitialHistory = fgHandle?.history() ?? [];

    // Batch to ensure reactive dependencies never see intermediate state.
    batch(() => {
      if (currentBgId) {
        splitManager.removeSplit(currentBgId);
      }

      const newFgHandle = splitManager.createNewSplit({
        content,
        initialHistory: newFgInitialHistory,
        activate: false,
        referredFrom,
      });

      setNewFgSlotId(newFgHandle.id);
    });

    if (forwardNavigationTrigger) {
      forwardNavigationTrigger();
    } else {
      completeNavigateForward();
    }
  }

  function completeNavigateForward() {
    const preparedFgId = bgSplitId();
    if (!preparedFgId) return;

    batch(() => {
      splitManager.activateSplit(preparedFgId);
      toggleFgSlot();
    });
  }

  function completeSwipeBack() {
    const isFgA = fgIsSlotA();
    const currentFgId = fgSplitId();
    const currentBgId = bgSplitId();
    // New BG content goes into the old FG slot (it becomes BG after the swap).
    const setNewBgSlotId = isFgA ? setSlotASplitId : setSlotBSplitId;

    if (!currentBgId) return;

    const bgHandle = splitManager.getSplit(currentBgId);
    if (!bgHandle) return;

    const newBgContent = bgHandle.previousContent();
    // Current content gets appended to history, so we want to slice before the new bg content
    const newBgInitialHistory = bgHandle.history().slice(0, -2);

    // Batch to ensure reactive dependencies never see intermediate state.
    batch(() => {
      if (currentFgId) {
        splitManager.removeSplit(currentFgId);
      }

      splitManager.activateSplit(currentBgId);

      const newBgHandle = newBgContent
        ? splitManager.createNewSplit({
            content: newBgContent,
            initialHistory: newBgInitialHistory,
            activate: false,
            referredFrom: null,
          })
        : undefined;

      setNewBgSlotId(newBgHandle?.id);
      toggleFgSlot();
    });
  }

  function setAnimatedTrigger(trigger: (() => void) | undefined) {
    animatedTrigger = trigger;
  }

  function setForwardNavigationTrigger(trigger: (() => void) | undefined) {
    forwardNavigationTrigger = trigger;
  }

  function swipeBack() {
    if (!canGoBack()) return;
    if (animatedTrigger) {
      animatedTrigger();
    } else {
      completeSwipeBack();
    }
  }

  return {
    slotASplitId,
    slotBSplitId,
    fgIsSlotA,
    canGoBack,
    completeSwipeBack,
    completeNavigateForward,
    setAnimatedTrigger,
    setForwardNavigationTrigger,
    swipeBack,
  };
}
