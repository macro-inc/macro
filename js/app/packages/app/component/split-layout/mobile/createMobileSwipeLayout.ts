import { batch, createSignal } from 'solid-js';
import type {
  OpenWithSplitOptions,
  ReferredFrom,
  SplitContent,
  SplitId,
  SplitManager,
} from '../layoutManager';

export type MobileSwipeLayout = {
  slotASplitId: () => SplitId | undefined;
  slotBSplitId: () => SplitId | undefined;
  /** True when slot A is the foreground; false when slot B is the foreground. */
  fgIsSlotA: () => boolean;
  canGoBack: () => boolean;
  /**
   * Intercepts forward navigation on mobile.
   * Puts the new content into the current BG slot, demotes the current FG to BG,
   * then flips the FG/BG role — zero remount on the new FG slot.
   */
  navigateForward: (
    content: SplitContent,
    options?: Pick<OpenWithSplitOptions, 'referredFrom'>
  ) => void;
  /**
   * Completes a swipe-back. Flips the FG/BG role so the current BG slot becomes FG, destroys the old FG, and mounts a
   * new BG from the promoted split's history into the old FG slot.
   */
  completeSwipeBack: () => void;
  /**
   * Register an animated trigger provided by MobileSwipeBackContainer.
   * When set, swipeBack() will animate before completing.
   */
  setAnimatedTrigger: (trigger: (() => void) | undefined) => void;
  /**
   * Initiate a swipe-back
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

  const fgSplitId = () => (fgIsSlotA() ? slotASplitId() : slotBSplitId());
  const bgSplitId = () => (fgIsSlotA() ? slotBSplitId() : slotASplitId());

  function canGoBack() {
    return bgSplitId() !== undefined;
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
    const newFgInitialHistory = fgHandle?.history() ?? [];

    // Batch to ensure reactive dependencies never see intermediate state.
    batch(() => {
      if (currentBgId) {
        splitManager.removeSplit(currentBgId);
      }

      const newFgHandle = splitManager.createNewSplit({
        content,
        initialHistory: newFgInitialHistory,
        activate: true,
        referredFrom,
        isBackground: false,
      });

      // Demote FG → BG
      if (currentFgId) {
        splitManager.setBackground(currentFgId, true);
      }

      setNewFgSlotId(newFgHandle.id);

      toggleFgSlot();
    });
  }

  function completeSwipeBack() {
    const isFgA = fgIsSlotA();
    const currentFgId = fgSplitId();
    const currentBgId = bgSplitId();
    // New BG content (page behind the promoted split) goes into the old FG slot (it becomes BG after swap).
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

      // Promote BG → FG
      splitManager.setBackground(currentBgId, false);

      const newBgHandle = newBgContent
        ? splitManager.createNewSplit({
            content: newBgContent,
            initialHistory: newBgInitialHistory,
            activate: false,
            referredFrom: null,
            isBackground: true,
          })
        : undefined;

      setNewBgSlotId(newBgHandle?.id);

      toggleFgSlot();
    });
  }

  function setAnimatedTrigger(trigger: (() => void) | undefined) {
    animatedTrigger = trigger;
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
    navigateForward,
    completeSwipeBack,
    setAnimatedTrigger,
    swipeBack,
  };
}
