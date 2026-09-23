import { globalSplitManager } from '@app/signal/splitLayout';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useContext } from 'solid-js';
import { SplitPanelContext } from './context';
import type {
  OpenSplitResult,
  OpenWithSplitOptions,
  PopoverSplitOptions,
  ReferredFrom,
  SplitContent,
} from './layoutManager';

export function useSplitLayout() {
  const splitPanelContext = useContext(SplitPanelContext);

  function openWithSplit(
    content: SplitContent,
    options?: OpenWithSplitOptions
  ): OpenSplitResult {
    const splitManager = globalSplitManager();
    const preferNewSplit = isTouchDevice() ? false : options?.preferNewSplit;

    if (!splitManager) {
      console.error('No split manager found');
      return { status: 'unavailable' };
    }

    // Use the source panel for navigation. Popover handles cannot replace
    // content, so navigation from a popover falls back to the active split.
    const requestedHandle = options?.handle ?? splitPanelContext?.handle;
    const handle = requestedHandle?.isPopover() ? undefined : requestedHandle;

    return splitManager.openWithSplit(content, {
      ...options,
      preferNewSplit,
      handle,
    });
  }

  function replaceOrInsertSplit(
    content: SplitContent,
    referredFrom: ReferredFrom = null
  ) {
    return openWithSplit(content, {
      referredFrom,
      handle: splitPanelContext?.handle,
      activate: true,
    }).split;
  }

  function replaceSplit(options: {
    content: SplitContent;
    mergeHistory?: boolean;
    referredFrom?: ReferredFrom;
  }) {
    const { content, mergeHistory, referredFrom } = options;

    return openWithSplit(content, {
      mergeHistory,
      referredFrom,
      handle: splitPanelContext?.handle,
      preferNewSplit: false,
    }).split;
  }

  function insertSplit(
    content: SplitContent,
    referredFrom: ReferredFrom = null,
    options: Pick<OpenWithSplitOptions, 'insertIndex'> = {}
  ) {
    return openWithSplit(content, {
      activate: true,
      referredFrom,
      preferNewSplit: true,
      ...options,
    }).split;
  }

  function popoverSplit(
    content: SplitContent,
    options: Omit<PopoverSplitOptions, 'content'> = {}
  ) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('no split manager found');
      return;
    }
    return splitManager.createPopoverSplit({ ...options, content });
  }

  function replaceAllSplits(
    content: SplitContent,
    options?: { referredFrom?: ReferredFrom }
  ) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('No split manager found');
      return;
    }
    return splitManager.replaceAllSplits(content, options);
  }

  function resetSplit() {
    if (!splitPanelContext) {
      console.error('No split panel context found');
      return;
    }

    splitPanelContext.handle.reset();
  }

  function getSplitCount() {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      return 0;
    }
    return splitManager.getVisibleSplitCount();
  }

  return {
    openWithSplit,
    getSplitCount,
    replaceOrInsertSplit,
    replaceSplit,
    insertSplit,
    resetSplit,
    popoverSplit,
    replaceAllSplits,
  };
}
