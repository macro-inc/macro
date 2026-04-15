import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { createSoupState } from '@app/component/next-soup/create-soup-state';
import { SoupContextProvider } from '@app/component/next-soup/soup-context';
import { activeElement } from '@app/signal/focus';
import { Resize } from '@core/component/Resize';
import { tabTitleSignal } from '@core/signal/tabTitle';
import { createElementSize } from '@solid-primitives/resize-observer';
import { useNavigate } from '@solidjs/router';
import { useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  type Setter,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { PopoverSplitRenderer } from './components/PopoverSplitRenderer';
import { SplitContainer } from './components/SplitContainer';
import {
  SplitLayoutContext,
  SplitPanelContext,
  type SplitPanelContextType,
} from './context';
import { useSplitLayout } from './layout';
import {
  createSplitLayout,
  type SplitContent,
  SplitEvent,
  type SplitEventWithType,
  type SplitHandle,
  type SplitId,
  type SplitManager,
  type SplitState,
} from './layoutManager';
import { decodePairs } from './layoutUtils';
import { createHeaderCollapser } from './utils/createHeaderCollapser';
import { registerSplitHotkeys } from './registerSplitHotkeys';
import { isListViewID } from '@app/constants/list-views';
import { isMobile } from '@core/mobile/isMobile';
import { isSidebarVisible } from '@app/component/sidebarVisibility';
import { cn } from '@ui/utils/classname';
import {
  createMobileSwipeLayout,
  type MobileSwipeLayout,
} from './mobile/createMobileSwipeLayout';

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
    on([() => splitManager.splits().length], () => {
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

type SplitPanelProps = {
  split: SplitState;
  handle: SplitHandle;
  active: boolean;
  setPanelRef: (ref: HTMLDivElement) => void;
  index: number;
};

function SplitPanel(props: SplitPanelProps) {
  const [panelRef, setPanelRef] = createSignal<HTMLDivElement | null>(null);
  const [attachHotKeys, splitHotkeyScope] = useHotkeyDOMScope(
    `split=${props.split.id}`
  );

  const panelSize = createElementSize(panelRef);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);

  const [previewState, setPreviewState] = createSignal(false);

  const layoutRefs: SplitPanelContextType['layoutRefs'] = {};
  const headerCollapser = createHeaderCollapser(
    () => layoutRefs.headerLeft,
    () => panelSize.width
  );

  const splitLayoutHelpers = useSplitLayout();
  registerSplitHotkeys({
    splitHotkeyScope,
    insertSplit: splitLayoutHelpers.insertSplit,
    closeSplit: () => props.handle.close(),
    toggleSpotlight: () => props.handle.toggleSpotlight(),
    canGoBack: () => props.handle.canGoBack(),
    goBack: () => props.handle.goBack(),
    canGoForward: () => props.handle.canGoForward(),
    goForward: () => props.handle.goForward(),
    replaceSplit: splitLayoutHelpers.replaceSplit,
    splitName: () => props.handle.displayName(),
    getSplitCount: () => splitLayoutHelpers.getSplitCount(),
    isNotUnifiedList: () => {
      const content = props.handle.content();
      return !isListViewID(content.id);
    },
  });

  const nextSoup = createSoupState({
    initialFilters: ['explicit-noise'],
  });

  return (
    <SoupContextProvider soup={nextSoup}>
      <SplitPanelContext.Provider
        value={{
          handle: props.handle,
          splitHotkeyScope,
          isPanelActive: () => props.active,
          panelRef,
          panelSize,
          layoutRefs,
          contentOffsetTop,
          setContentOffsetTop,
          previewState: [previewState, setPreviewState],
          headerCollapser,
        }}
      >
        <SplitContainer
          id={props.split.id}
          ref={(ref) => {
            setPanelRef(ref);
            props.setPanelRef(ref);
            attachHotKeys(ref);
          }}
          tl={props.index === 0 && !isMobile()}
          bl={props.index === 0 && !isMobile()}
          tr={
            splitLayoutHelpers.getSplitCount() > 1 &&
            props.index === splitLayoutHelpers.getSplitCount() - 1 &&
            !isMobile()
          }
          br={
            splitLayoutHelpers.getSplitCount() > 1 &&
            props.index === splitLayoutHelpers.getSplitCount() - 1 &&
            !isMobile()
          }
        >
          <Suspense>
            <Dynamic component={props.split.mount.element} />
          </Suspense>
        </SplitContainer>
      </SplitPanelContext.Provider>
    </SoupContextProvider>
  );
}

// ---------------------------------------------------------------------------
// Mobile swipe-back stacked layout
// ---------------------------------------------------------------------------

const SWIPE_EDGE_THRESHOLD = 28; // px from left edge to initiate gesture
const SWIPE_VELOCITY_THRESHOLD = 0.3; // px/ms — fast flick completes swipe
const SWIPE_DISTANCE_THRESHOLD = 0.5; // fraction of screen width
const SWIPE_ANIMATION_MS = 150;

type MobileSwipeBackContainerProps = {
  splitManager: SplitManager;
  mobileSwipeLayout: MobileSwipeLayout;
  splits: Accessor<ReadonlyArray<SplitState>>;
  panelRefs: Map<SplitId, HTMLDivElement>;
};

function MobileSwipeBackContainer(props: MobileSwipeBackContainerProps) {
  const { splitManager, mobileSwipeLayout } = props;

  const [dragOffset, setDragOffset] = createSignal(0);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isAnimatingOut, setIsAnimatingOut] = createSignal(false);

  let startX = 0;
  let startTime = 0;
  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(animationTimer));

  function animateComplete(onDone: () => void) {
    setIsAnimatingOut(true);
    setDragOffset(window.innerWidth);
    animationTimer = setTimeout(() => {
      batch(() => {
        setIsAnimatingOut(false);
        setDragOffset(0);
        onDone();
      });
    }, SWIPE_ANIMATION_MS);
  }

  function animateSnapBack() {
    setIsAnimatingOut(true);
    setDragOffset(0);
    animationTimer = setTimeout(
      () => setIsAnimatingOut(false),
      SWIPE_ANIMATION_MS
    );
  }

  function triggerAnimatedSwipeBack() {
    if (!mobileSwipeLayout.canGoBack()) return;
    animateComplete(() => mobileSwipeLayout.completeSwipeBack());
  }

  // Register the animated trigger so the back button can invoke it.
  onMount(() => mobileSwipeLayout.setAnimatedTrigger(triggerAnimatedSwipeBack));
  onCleanup(() => mobileSwipeLayout.setAnimatedTrigger(undefined));

  function handleTouchStart(e: TouchEvent) {
    if (!mobileSwipeLayout.canGoBack()) return;
    const touch = e.touches[0];
    if (!touch || touch.clientX > SWIPE_EDGE_THRESHOLD) return;
    startX = touch.clientX;
    startTime = Date.now();
    setIsDragging(true);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isDragging()) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = Math.max(0, touch.clientX - startX);
    setDragOffset(dx);
  }

  function handleTouchEnd() {
    if (!isDragging()) return;
    setIsDragging(false);
    const dx = dragOffset();
    const elapsed = Date.now() - startTime;
    const velocity = elapsed > 0 ? dx / elapsed : 0;
    const threshold = window.innerWidth * SWIPE_DISTANCE_THRESHOLD;
    if (dx > threshold || velocity > SWIPE_VELOCITY_THRESHOLD) {
      animateComplete(() => mobileSwipeLayout.completeSwipeBack());
    } else {
      animateSnapBack();
    }
  }

  const slotAData = createMemo(() => {
    const id = mobileSwipeLayout.slotASplitId();
    if (!id) return undefined;
    const split = props.splits().find((s) => s.id === id);
    const rawHandle = splitManager.getSplit(id);
    if (!split || !rawHandle) return undefined;
    const handle: SplitHandle = {
      ...rawHandle,
      goBack: () => mobileSwipeLayout.swipeBack(),
      canGoBack: () => mobileSwipeLayout.canGoBack(),
    };
    return { split, handle };
  });

  const slotBData = createMemo(() => {
    const id = mobileSwipeLayout.slotBSplitId();
    if (!id) return undefined;
    const split = props.splits().find((s) => s.id === id);
    const rawHandle = splitManager.getSplit(id);
    if (!split || !rawHandle) return undefined;
    const handle: SplitHandle = {
      ...rawHandle,
      goBack: () => mobileSwipeLayout.swipeBack(),
      canGoBack: () => mobileSwipeLayout.canGoBack(),
    };
    return { split, handle };
  });

  function getFgTransition(): string {
    if (isDragging()) return 'none';
    if (isAnimatingOut()) return `transform ${SWIPE_ANIMATION_MS}ms ease-out`;
    return 'none';
  }

  // FG translation style — applied only to the currently-active FG slot div.
  const fgStyle = () => ({
    transform: `translateX(${dragOffset()}px)`,
    transition: getFgTransition(),
    'will-change': 'transform',
  });

  return (
    <div
      class="relative size-full overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        if (!isDragging()) return;
        setIsDragging(false);
        animateSnapBack();
      }}
    >
      <Show when={slotAData()}>
        {(a) => (
          <div
            class={cn('absolute inset-0', {
              'z-10': mobileSwipeLayout.fgIsSlotA(),
              '-z-100 pointer-events-none': !mobileSwipeLayout.fgIsSlotA(),
            })}
            style={mobileSwipeLayout.fgIsSlotA() ? fgStyle() : undefined}
          >
            {/*
             * Key by content id so that SplitPanel (and its soup state) remounts when the slot's content changes, needed for dock / soup-view navigation.
             */}
            <Show when={a().split.content.id} keyed>
              {(_contentId) => (
                <Suspense>
                  <SplitPanel
                    split={a().split}
                    handle={a().handle}
                    active={mobileSwipeLayout.fgIsSlotA()}
                    setPanelRef={(ref) =>
                      props.panelRefs.set(a().split.id, ref)
                    }
                    index={0}
                  />
                </Suspense>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show when={slotBData()}>
        {(b) => (
          <div
            class={cn('absolute inset-0', {
              'z-10': !mobileSwipeLayout.fgIsSlotA(),
              '-z-100 pointer-events-none': mobileSwipeLayout.fgIsSlotA(),
            })}
            style={!mobileSwipeLayout.fgIsSlotA() ? fgStyle() : undefined}
          >
            <Show when={b().split.content.id} keyed>
              {(_contentId) => (
                <Suspense>
                  <SplitPanel
                    split={b().split}
                    handle={b().handle}
                    active={!mobileSwipeLayout.fgIsSlotA()}
                    setPanelRef={(ref) =>
                      props.panelRefs.set(b().split.id, ref)
                    }
                    index={1}
                  />
                </Suspense>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
