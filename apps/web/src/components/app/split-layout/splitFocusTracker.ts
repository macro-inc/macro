import { activeElement } from '@app/signal/focus';
import { splitContainerSelector } from '@core/dom-selectors';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import {
  SplitEvent,
  type SplitEventWithType,
  type SplitId,
  type SplitManager,
  type SplitState,
} from './layoutManager';

function getParentSplitId(element: Element | null) {
  if (!element || !element.isConnected) return null;
  const splitParent = element.closest(splitContainerSelector);
  if (!splitParent) return null;
  const splitId = splitParent.getAttribute('data-split-id');
  if (!splitId) return null;
  return splitId as SplitId;
}

/**
 * Manages focus / active between splits
 *
 * When a split is focused, it should become the active split.
 * When a split looses focus to a non-split element, the active split should NOT change.
 * Inserting / Removing splits are explicitly handled:
 *   - When a split is inserted, it should be focused and activated
 *   - When a split is removed, the next split should be focused
 */
export function createSplitFocusTracker(props: {
  splitManager: SplitManager;
  panelRefs: Map<SplitId, HTMLDivElement>;
  splits: Accessor<ReadonlyArray<SplitState>>;
}) {
  const DEBOUNCE = 40;
  const activeSplitId = () => props.splitManager.activeSplitId();

  const currentSplitsIds = () => new Set(props.splits().map((s) => s.id));
  const lastFocusedChildBySplitId: Map<SplitId, HTMLElement | null> = new Map();
  createEffect(
    on(currentSplitsIds, (ids) => {
      for (const key of lastFocusedChildBySplitId.keys()) {
        if (!ids.has(key)) {
          lastFocusedChildBySplitId.delete(key);
        }
      }
    })
  );

  const isElementInPanel = (
    panelId: SplitId,
    element: Element | null
  ): boolean => {
    const panelRef = props.panelRefs.get(panelId);
    if (!panelRef || element === null) return false;
    return panelRef === element || panelRef.contains(element);
  };

  const focusSplitById = (id: SplitId) => {
    const splitPanelRef = props.panelRefs.get(id);
    if (!splitPanelRef) {
      console.warn(`Tried to focus split with id ${id} but it doesn't exist`);
      return;
    }

    // return if panel has a child already with focus.
    if (
      splitPanelRef.contains(document.activeElement) &&
      splitPanelRef !== document.activeElement
    )
      return;

    // look for a child to return focus to.
    const child = lastFocusedChildBySplitId.get(id);
    if (child && child.isConnected) {
      child.focus();
      return;
    }

    splitPanelRef.focus();
  };

  const activateFocusedSplit = (element: Element) => {
    const splitId = activeSplitId();
    if (!splitId) return;

    const doesActiveSplitHaveFocus = isElementInPanel(splitId, element);

    if (doesActiveSplitHaveFocus) {
      return;
    }

    let splitWithFocus: SplitId | undefined;
    // Only visible splits may claim activation — the mobile background
    // split is excluded and can never become active.
    for (const split of props.splitManager.getVisibleSplits()) {
      if (isElementInPanel(split.id, element)) {
        splitWithFocus = split.id;
        break;
      }
    }

    if (splitWithFocus) {
      props.splitManager.activateSplit(splitWithFocus);
    }
  };

  const findNextSplitToActivate = (splitIndex: number): SplitId | undefined => {
    const nextSplitId =
      splitIndex === 0
        ? props.splits()[0].id
        : props.splits()[splitIndex - 1].id;

    return nextSplitId;
  };

  const focusFromEvent = (event: SplitEventWithType) => {
    switch (event.type) {
      case SplitEvent.Insert: {
        if (event.activate === false) break;
        // A fresh load replays its last Insert event once this tracker
        // mounts, and the last URL split is often a restored Preview Pair's
        // Viewer. The Viewer displays content passively while its Controller
        // owns the keyboard (restorePreviewPair already returned activation
        // to it), so initial focus follows the Controller too.
        const splitId =
          props.splitManager.controllerOf(event.splitId) ?? event.splitId;
        focusSplitById(splitId);
        break;
      }
      case SplitEvent.Remove: {
        const splitId = findNextSplitToActivate(event.splitIndex);
        if (splitId) {
          focusSplitById(splitId);
        }
        break;
      }
    }
  };

  // Both of these effects need to be debounced to prevent race conditions.
  // The button for creating a new split itself is in a SplitPanel. This means that without the debounce,
  // the button in the old split might trigger another focus event and re-active the old split.
  let focusTimeout: ReturnType<typeof setTimeout> | undefined;
  let activateTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastProgrammaticActivation = 0;

  // Disposal must cancel pending debounced work so it cannot focus stale
  // panels or activate splits on a torn-down manager after unmount.
  onCleanup(() => {
    clearTimeout(focusTimeout);
    clearTimeout(activateTimeout);
  });

  /** Listens for explicit events from layoutManager that might trigger focus changes */
  createEffect(
    on(
      () => props.splitManager.events(),
      (newEvent) => {
        if (focusTimeout) {
          clearTimeout(focusTimeout);
        }
        if (newEvent.type === SplitEvent.ReturnFocus) {
          const id = props.splitManager.activeSplitId();
          if (id) {
            focusSplitById(id);
          }
          return;
        }
        focusTimeout = setTimeout(() => {
          focusFromEvent(newEvent);
        }, DEBOUNCE);
      }
    )
  );

  /** Track when splits are programmatically activated */
  createEffect(
    on(activeSplitId, () => {
      lastProgrammaticActivation = Date.now();
    })
  );

  /** Listens for focus changes on the document */
  createEffect(
    on(activeElement, (element) => {
      if (activateTimeout) {
        clearTimeout(activateTimeout);
      }
      if (!element) return;

      const parentId = getParentSplitId(element);
      if (
        parentId &&
        element instanceof HTMLElement &&
        !element.closest('[data-no-focus-restore]')
      ) {
        lastFocusedChildBySplitId.set(parentId, element);
      }

      activateTimeout = setTimeout(() => {
        const timeSinceActivation = Date.now() - lastProgrammaticActivation;

        // If a split was just programmatically activated, ignore this focus change
        if (timeSinceActivation < DEBOUNCE + 50) {
          return;
        }

        activateFocusedSplit(element);
      }, DEBOUNCE);
    })
  );

  return { focusSplitById };
}
