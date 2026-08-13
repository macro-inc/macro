import { globalSplitManager } from '@app/signal/splitLayout';
import { isMobile } from '@core/mobile/isMobile';
import { useContext } from 'solid-js';
import { SplitPanelContext } from './context';
import type {
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
  ) {
    const splitManager = globalSplitManager();
    const preferNewSplit = isMobile() ? false : options?.preferNewSplit;

    if (!splitManager) {
      console.error('No split manager found');
      return;
    }

    // Navigation issued from inside a split panel (links, mentions, references)
    // carries that panel as its source; callers outside any panel (sidebar,
    // command menu) stay handle-less, which is what marks "external navigation"
    // for Preview Pair routing. A popover's SplitPanelContext handle is a stub
    // whose replace() is a no-op, so treat popover sources as handle-less too
    // and let same-split navigation fall back to the active split.
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
    });
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
    });
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
    });
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
