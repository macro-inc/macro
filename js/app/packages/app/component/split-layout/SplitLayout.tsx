import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { activeElement } from '@app/signal/focus';
import { Resize } from '@core/component/Resize';
import { isMobile } from '@core/mobile/isMobile';
import { isSidebarVisible } from '@app/component/sidebarVisibility';
import { tabTitleSignal } from '@core/signal/tabTitle';
import { useNavigate } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSelector,
  For,
  on,
  onCleanup,
  type Setter,
  Show,
  Suspense,
} from 'solid-js';
import { PopoverSplitRenderer } from './components/PopoverSplitRenderer';
import { SplitPanel } from './components/SplitPanel';
import { SplitLayoutContext } from './context';
import {
  createSplitLayout,
  type SplitContent,
  SplitEvent,
  type SplitEventWithType,
  type SplitId,
  type SplitManager,
  type SplitState,
} from './layoutManager';
import { decodePairs } from './layoutUtils';
import { cn } from '@ui/utils/classname';
import {
  createMobileSwipeLayout,
  type MobileSwipeLayout,
} from './mobile/createMobileSwipeLayout';
import { MobileSwipeBackContainer } from './mobile/MobileSwipeBackContainer';

type SplitLayoutContainerProps = {
  pairs: string[];
  setManager: Setter<SplitManager | undefined>;
};

function getParentSplitId(element: Element | null) {
  if (!element || !element.isConnected) return null;
  const splitParent = element.closest('[data-split-container]');
  if (!splitParent) return null;
  const splitId = splitParent.getAttribute('data-split-id');
  if (!splitId) return null;
  return splitId as SplitId;
}

/**
 * Creates an effect that syncs the layout manager with the URL.
 *
 * @param splitManager The layout manager to sync with
 * @param pairs The accessor to the current pairs
 * @param decodedPairs The accessor to the decoded pairs
 */
function createLayoutUrlSync(
  splitManager: SplitManager,
  pairs: Accessor<string[]>,
  decodedPairs: Accessor<SplitContent[]>
) {
  const navigate = useNavigate();
  const urlLayoutDrift = createMemo(
    () => splitManager.getUrlSegments().join('/') !== pairs().join('/')
  );

  /** Syncs changes from the layout manager to the URL*/
  createEffect(
    on([() => splitManager.getUrlSegments().join('/')], () => {
      if (urlLayoutDrift()) {
        // Flush the state to the url
        navigate(`/${splitManager.getUrlSegments().join('/')}`);
      }
    })
  );

  /** Syncs changes from the URL to the layout manager */
  createEffect(
    on([pairs], () => {
      if (urlLayoutDrift()) {
        splitManager.reconcile(decodedPairs());
      }
    })
  );
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
function createSplitFocusTracker(props: {
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
    for (const split of props.splits()) {
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
        const splitId = event.splitId;
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
      if (parentId && element instanceof HTMLElement) {
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

export function SplitLayoutContainer(props: SplitLayoutContainerProps) {
  const decodedPairs = () => decodePairs(props.pairs);
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const splitManager = createSplitLayout(blockOrchestrator, decodedPairs());
  const [, setTabTitle] = tabTitleSignal;

  // Create the mobile swipe layout once on mobile devices.
  const mobileSwipeLayout: MobileSwipeLayout | undefined = isMobile()
    ? createMobileSwipeLayout(splitManager)
    : undefined;

  // Store a ref to each panel by id
  const panelRefs = new Map<SplitId, HTMLDivElement>();
  createEffect(
    on(splitManager.events, (event) => {
      if (event.type === SplitEvent.Remove) {
        panelRefs.delete(event.splitId);
      }
    })
  );

  const splits = createMemo(splitManager.splits);

  const activeSplitSelector = createSelector(splitManager.activeSplitId);

  createEffect(() => props.setManager(splitManager));

  onCleanup(() => props.setManager(undefined));

  createEffect(() => {
    setTabTitle(splitManager.tabTitle());
  });

  // <For> on plain ids for stable referential equality
  const ids = createMemo(() => splits().map(({ id }) => id));

  createLayoutUrlSync(splitManager, () => props.pairs, decodedPairs);
  createSplitFocusTracker({ splitManager, panelRefs, splits });

  return (
    <SplitLayoutContext.Provider value={{ manager: splitManager }}>
      <div
        class={cn('size-full p-2 mobile:p-0', { 'pl-0': isSidebarVisible() })}
      >
        <Show
          when={isMobile() && mobileSwipeLayout}
          fallback={
            // Desktop: side-by-side resizable splits.
            <Resize.Zone
              direction="horizontal"
              gutter={4}
              captureResizeCtx={splitManager.setResizeContext}
            >
              <For each={ids()}>
                {(id, index) => (
                  <Show when={splitManager.getSplit(id)}>
                    {(handle) => (
                      <Suspense>
                        <Resize.Panel id={id} minSize={400} index={index()}>
                          <SplitPanel
                            split={splits()[index()]!}
                            handle={handle()}
                            active={activeSplitSelector(id)}
                            setPanelRef={(panelRef) =>
                              panelRefs.set(id, panelRef)
                            }
                            index={index()}
                          />
                        </Resize.Panel>
                      </Suspense>
                    )}
                  </Show>
                )}
              </For>
            </Resize.Zone>
          }
        >
          {/* Mobile: stacked FG/BG layout with swipe-back gesture. */}
          <MobileSwipeBackContainer
            splitManager={splitManager}
            mobileSwipeLayout={mobileSwipeLayout!}
            splits={splits}
            panelRefs={panelRefs}
          />
        </Show>
      </div>
      <PopoverSplitRenderer
        popovers={splitManager.popovers}
        onClosePopover={(id) => {
          const activePopovers = splitManager.getActivePopovers();
          const popover = activePopovers.find((p) => p.id === id);
          popover?.close();
        }}
      />
    </SplitLayoutContext.Provider>
  );
}
