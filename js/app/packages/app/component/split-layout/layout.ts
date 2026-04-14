import { useContext } from 'solid-js';
import { globalSplitManager } from '../../signal/splitLayout';
import { SplitPanelContext } from './context';
import type {
  OpenWithSplitOptions,
  ReferredFrom,
  SplitContent,
} from './layoutManager';
import { isMobile } from '@core/mobile/isMobile';

export function useSplitLayout() {
  const splitPanelContext = useContext(SplitPanelContext);

  function openWithSplit(
    content: SplitContent,
    options?: OpenWithSplitOptions
  ) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('No split manager found');
      return;
    }

    const preferNewSplit = isMobile() ? false : options?.preferNewSplit;

    return splitManager.openWithSplit(content, {
      ...options,
      preferNewSplit,
    });
  }

  function replaceOrInsertSplit(
    content: SplitContent,
    referredFrom: ReferredFrom = null
  ) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('No split manager found');
      return;
    }

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
    referredFrom: ReferredFrom = null
  ) {
    return openWithSplit(content, {
      activate: true,
      referredFrom,
      preferNewSplit: true,
    });
  }

  function popoverSplit(content: SplitContent) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('no split manager found');
      return;
    }
    return splitManager.createPopoverSplit({ content: content });
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
  };
}
