import { globalSplitManager } from '@app/signal/splitLayout';
import type { BlockAlias, BlockName } from '@core/block';
import { isBlockAlias, resolveBlockAlias } from '@core/constant/allBlocks';
import type { ViewId } from '@core/types/view';
import { createCallback } from '@solid-primitives/rootless';
import { type Accessor, createMemo, useContext } from 'solid-js';
import { SplitLayoutContext, SplitPanelContext } from './context';
import type {
  SplitContent,
  SplitContentType,
  SplitHandle,
  SplitManager,
} from './layoutManager';

export function decodePairs(segments: string[]): SplitContent[] {
  const pairs: SplitContent[] = [];
  for (let i = 0; i < segments.length; i += 2) {
    const type = segments[i];
    const id = segments[i + 1];
    if (!type || !id) break;

    if (type === 'component') {
      pairs.push({ type: 'component', id });
    } else {
      const resolvedType = resolveBlockAlias(type as BlockName | BlockAlias);
      if (isBlockAlias(type)) {
        const content: SplitContent = {
          type,
          id,
          aliasContext: {
            alias: type,
            baseType: resolvedType,
          },
        };
        pairs.push(content);
      } else {
        const content: SplitContent = { type: resolvedType, id };
        pairs.push(content);
      }
    }
  }
  return pairs.length ? pairs : [{ type: 'component', id: 'unified-list' }];
}

export function encodePairs(splits: ReadonlyArray<SplitContent>): string[] {
  return splits.flatMap((s) => [
    // Use the alias type if available, otherwise use the base type
    s.type === 'component' ? s.type : s.aliasContext?.alias || s.type,
    s.id,
  ]);
}

export const isInSplit = createCallback(() => {
  return !!useContext(SplitPanelContext);
});

export const isInSplitLayout = createCallback(() => {
  return !!useContext(SplitLayoutContext);
});

export const getSplitPanelRef = createCallback(() => {
  const ctx = useContext(SplitPanelContext);
  if (!ctx) return null;
  return ctx.panelRef() ?? null;
});

/**
 * Get the context value for the the SplitPanel.
 * @throws if used outside of a properly set up <SplitPanel/>
 * @returns
 */
export function useSplitPanelOrThrow() {
  const ctxValue = useContext(SplitPanelContext);
  if (ctxValue === undefined) {
    console.trace(
      'You are trying to access SplitPanelContext outside of a <SplitPanel />!'
    );
    throw new Error(
      'You are trying to access SplitPanelContext outside of a <SplitPanel />!'
    );
  }
  return ctxValue;
}

/**
 * Get the context value for the the SplitPanel with possible undefined.
 * @returns
 */
export function useSplitPanel() {
  return useContext(SplitPanelContext);
}

/**
 * Remove all the items from all split histories that meet a certain criteria.
 * @param manager
 * @param predicate A function that returns true to remove a SplitContent entry
 *     from all splits' histories.
 */
export function globalRemoveFromSplitHistory(
  manager: SplitManager,
  predicate: (item: SplitContent) => boolean
) {
  for (const split of manager.splits()) {
    const handle = manager.getSplit(split.id);
    handle?.removeFromHistory(predicate);
  }
}

export function focusAdjacentSplit(direction: 'left' | 'right') {
  const splitManager = globalSplitManager();
  if (!splitManager) return;
  const activeSplitId = splitManager.activeSplitId();
  if (!activeSplitId) return;
  const currentSplitIds = splitManager.splits().map((s) => s.id);
  const currentSplitIndex = currentSplitIds.indexOf(activeSplitId);
  const getAdjacentSplitId = () => {
    if (direction === 'left') {
      if (currentSplitIndex === 0)
        return currentSplitIds[currentSplitIds.length - 1];
      return currentSplitIds[currentSplitIndex - 1];
    } else {
      if (currentSplitIndex === currentSplitIds.length - 1)
        return currentSplitIds[0];
      return currentSplitIds[currentSplitIndex + 1];
    }
  };
  const adjacentSplitId = getAdjacentSplitId();
  if (!adjacentSplitId) return;
  splitManager.activateSplit(adjacentSplitId);
  splitManager.returnFocus();
}

/**
 * Check if there's a unified-list split with a particular view open. Note: not necessarily the active split.
 */
export function isViewOpen(manager: SplitManager | undefined, viewId: ViewId) {
  if (!manager) return false;
  const split = manager.getSplitByContent('component', 'unified-list');
  return split?.meta()?.viewId === viewId;
}

/**
 * Reactive accessor indicating whether there's a unified-list split with a particular view open. Note: not necessarily the active split.
 */
export function createIsViewOpenMemo(
  manager: SplitManager | undefined,
  viewId: ViewId
) {
  return createMemo(() => isViewOpen(manager, viewId));
}

/**
 * Reactive boolean accessor indicating whether the active split is currently
 * showing a specific component content id.
 */
export function createIsActiveSplitContentMemo(
  activeSplit: Accessor<SplitHandle | undefined>,
  contentType: SplitContentType,
  id: string
) {
  return createMemo(() => {
    const content = activeSplit()?.content();
    return content?.type === contentType && content.id === id;
  });
}
