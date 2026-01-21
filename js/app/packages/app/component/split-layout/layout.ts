import { useContext } from 'solid-js';
import { globalSplitManager } from '../../signal/splitLayout';
import { SplitPanelContext } from './context';
import type { ReferredFrom, SplitContent } from './layoutManager';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

export function useSplitLayout() {
  const splitPanelContext = useContext(SplitPanelContext);

  function replaceOrInsertSplit(
    content: SplitContent,
    referredFrom: ReferredFrom = null
  ) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('No split manager found');
      return;
    }

    const existingSplit = splitManager.getSplitByContent(
      content.type,
      content.id
    );

    if (existingSplit) {
      return existingSplit;
    }

    if (splitPanelContext) {
      splitPanelContext.handle.replace({
        next: content,
        referredFrom: referredFrom ?? null,
      });
      return splitPanelContext.handle;
    } else {
      return splitManager.createNewSplit({
        content,
        activate: true,
        referredFrom,
      });
    }
  }

  function replaceSplit(options: {
    content: SplitContent;
    mergeHistory?: boolean;
    referredFrom?: ReferredFrom;
  }) {
    const { content, mergeHistory, referredFrom } = options;
    if (splitPanelContext) {
      splitPanelContext.handle.replace({
        next: content,
        mergeHistory,
        referredFrom: referredFrom ?? null,
      });
      return splitPanelContext.handle;
    }
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('No split manager found');
      return;
    }

    const activeSplitId = splitManager.activeSplitId();
    const activeSplit = activeSplitId && splitManager.getSplit(activeSplitId);
    if (activeSplit) {
      activeSplit.replace({
        next: content,
        mergeHistory,
        referredFrom: referredFrom ?? null,
      });
      return activeSplit;
    }
  }

  function insertSplit(
    content: SplitContent,
    referredFrom: ReferredFrom = null
  ) {
    // On mobile, replace instead of inserting a new split
    if (isMobileWidth() && isTouchDevice()) {
      return replaceSplit({ content, referredFrom });
    }

    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('No split manager found');
      return;
    }
    return splitManager.createNewSplit({
      content,
      activate: true,
      referredFrom,
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
    getSplitCount,
    replaceOrInsertSplit,
    replaceSplit,
    insertSplit,
    resetSplit,
    popoverSplit,
  };
}
