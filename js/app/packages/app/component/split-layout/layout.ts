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

  function openWithSplit(options: OpenWithSplitOptions) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('No split manager found');
      return;
    }

    return splitManager.openWithSplit({
      ...options,
      force: isMobile() ? 'replace' : options.force,
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

    return openWithSplit({
      content,
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

    return openWithSplit({
      content: content,
      mergeHistory,
      referredFrom,
      handle: splitPanelContext?.handle,
      force: 'replace',
    });
  }

  function insertSplit(
    content: SplitContent,
    referredFrom: ReferredFrom = null
  ) {
    // On mobile, replace instead of inserting a new split
    if (isMobile()) {
      return replaceSplit({ content, referredFrom });
    }

    return openWithSplit({
      content,
      activate: true,
      referredFrom,
      force: 'insert',
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
    return splitManager.splits().length;
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
