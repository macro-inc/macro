import { useContext } from 'solid-js';
import { globalSplitManager } from '../../signal/splitLayout';
import { SplitPanelContext } from './context';
import type { SplitContent } from './layoutManager';

export function useSplitLayout() {
  const splitPanelContext = useContext(SplitPanelContext);

  function replaceOrInsertSplit(content: SplitContent) {
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
      splitPanelContext.handle.replace(content);
      return splitPanelContext.handle;
    } else {
      return splitManager.createNewSplit(content, true);
    }
  }

  function replaceSplit(content: SplitContent, mergeHistory?: boolean) {
    if (splitPanelContext) {
      splitPanelContext.handle.replace(content, mergeHistory);
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
      activeSplit.replace(content, mergeHistory);
      return activeSplit;
    }
  }

  function insertSplit(content: SplitContent) {
    const splitManager = globalSplitManager();
    if (!splitManager) {
      console.error('No split manager found');
      return;
    }
    return splitManager.createNewSplit(content, true);
  }

  function resetSplit() {
    if (!splitPanelContext) {
      console.error('No split panel context found');
      return;
    }

    splitPanelContext.handle.reset();
  }

  return {
    replaceOrInsertSplit: replaceOrInsertSplit,
    replaceSplit: replaceSplit,
    insertSplit: insertSplit,
    resetSplit: resetSplit,
  };
}
