import { isListViewID } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { createCallback } from '@solid-primitives/rootless';
import {
  type Accessor,
  createEffect,
  createMemo,
  onCleanup,
  untrack,
  useContext,
} from 'solid-js';
import {
  type CollapsibleItemInput,
  useRegisterPriorityCollapseItem,
} from '../../priority-collapse/createPriorityCollapser';
import { SplitLayoutContext, SplitPanelContext } from './context';
import type {
  SplitContent,
  SplitContentType,
  SplitHandle,
  SplitManager,
} from './layoutManager';
import { shouldAutofocusNavigation } from './should-autofocus-navigation';
import type { SplitDirection } from './split-direction';

const _isInSplit = createCallback(() => {
  return !!useContext(SplitPanelContext);
});

const _isInSplitLayout = createCallback(() => {
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
 * The view a split is in: the component it shows, or the nearest one behind
 * its content in history (the list a detail was opened from).
 */
export function splitViewId(
  handle: Pick<SplitHandle, 'history'>
): string | undefined {
  return handle.history().findLast((content) => content.type === 'component')
    ?.id;
}

/**
 * Creates or replaces a named resource under the current split panel's owner.
 * It lasts until the name is reused or the split moves to another view.
 */
export function withSplitPanelOwner<T>(name: string, factory: () => T): T {
  return useSplitPanelOrThrow().replaceOwnedSlot(name, factory);
}

/**
 * Get the context value for the the SplitPanel with possible undefined.
 * @returns
 */
export function useSplitPanel() {
  return useContext(SplitPanelContext);
}

/**
 * Own the split's display name while `name` is defined, then restore the name
 * that was visible before this owner became active.
 *
 * Routed detail views remain mounted inside their list shell, so writing the
 * name without restoring it leaves the browser tab titled after the departed
 * detail.
 */
export function useSplitDisplayName(name: Accessor<string | undefined>) {
  const handle = useSplitPanelOrThrow().handle;
  let owned = false;
  let previous = '';
  let displayed: string | undefined;

  const release = () => {
    if (!owned) return;
    if (handle.displayName() === displayed) {
      handle.setDisplayName(previous);
    }
    owned = false;
    displayed = undefined;
  };

  createEffect(() => {
    const next = name();
    if (next === undefined) {
      release();
      return;
    }
    if (!owned) {
      previous = untrack(handle.displayName);
      owned = true;
    }
    displayed = next;
    handle.setDisplayName(next);
  });

  onCleanup(release);
}

/** Whether closing this split leaves another split visible. */
export function shouldShowSplitCloseButton(manager: SplitManager) {
  return manager.getVisibleSplitCount() > 1;
}

/** Inline previews stay passive until the user focuses them. */
export function useCanAutofocusSplitContent() {
  const panel = useSplitPanel();
  if (panel?.isInlinePreview) return false;
  return panel
    ? shouldAutofocusNavigation(
        panel.handle.lastNavigationSource(),
        panel.handle.lastNavigationCause()
      )
    : true;
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

/**
 * Send a split back to the most recent soup list view in its history — e.g.
 * after deleting the entity it was showing — falling back to a reset (the
 * default inbox) when the history holds none. Reuses the stored entry, so
 * its captured state (scroll, focus) restores like a history-back, while
 * `mergeHistory` drops the split's current entry so the deleted entity does
 * not linger as a back target.
 */
export function returnSplitToRecentListView(handle: SplitHandle) {
  const target = handle
    .history()
    .slice(0, -1)
    .reverse()
    .find((item) => item.type === 'component' && isListViewID(item.id));
  if (target) {
    handle.replace({ next: target, mergeHistory: true });
  } else {
    handle.reset();
  }
}

/** Focuses the split beside the active one toward `direction`, as the splits tile. */
export function focusAdjacentSplit(direction: SplitDirection) {
  const splitManager = globalSplitManager();
  if (!splitManager) return;
  const activeSplitId = splitManager.activeSplitId();
  if (!activeSplitId) return;
  const adjacentSplitId = splitManager.adjacentSplit(activeSplitId, direction);
  if (!adjacentSplitId) return;
  splitManager.activateSplit(adjacentSplitId);
  splitManager.returnFocus();
}

/**
 * Reactive boolean accessor indicating whether the active split is currently
 * showing a specific component content id.
 */
function _createIsActiveSplitContentMemo(
  activeSplit: Accessor<SplitHandle | undefined>,
  contentType: SplitContentType,
  id: string
) {
  return createMemo(() => {
    const content = activeSplit()?.content();
    return content?.type === contentType && content.id === id;
  });
}

function useRegisterCollapsibleItem(
  input: CollapsibleItemInput,
  region: 'header' | 'toolbar'
): Accessor<boolean> {
  const ctx = useSplitPanelOrThrow();
  const collapser =
    region === 'header' ? ctx.headerCollapser : ctx.toolbarCollapser;
  return useRegisterPriorityCollapseItem(collapser, input);
}

export function useRegisterCollapsibleHeaderItem(
  input: CollapsibleItemInput
): Accessor<boolean> {
  return useRegisterCollapsibleItem(input, 'header');
}

export function useRegisterCollapsibleToolbarItem(
  input: CollapsibleItemInput
): Accessor<boolean> {
  return useRegisterCollapsibleItem(input, 'toolbar');
}
