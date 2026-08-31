import { isListViewID, LIST_VIEW_ID } from '@app/constants/list-views';
import { createSoupState } from '@app/features/next-soup/create-soup-state';
import { SoupContextProvider } from '@app/features/next-soup/soup-context';
import { SoupViewContextProvider } from '@app/features/next-soup/soup-view/soup-view-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { MobileTopEdgeFade } from '@components/app/mobile/MobileEdgeFade';
import { SplitPanelControllerProvider } from '@components/app/split-panel';
import { isSoloSettings } from '@core/constant/SettingsState';
import { BlockOpenTrackingDelayContext } from '@core/context/blockOpenTracking';
import { splitContainerAttribute } from '@core/dom-selectors';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getSafeAreaInset } from '@core/mobile/safeAreaInsets';
import CloseIcon from '@phosphor/x.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, cn, Panel } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { splitBackInterceptor } from '../back-interceptor';
import {
  type SplitBottomPanelRegistration,
  type SplitFileMenuActionGroups,
  SplitPanelContext,
  type SplitPanelContextType,
} from '../context';
import { useSplitLayout } from '../layout';
import type { SplitHandle, SplitState } from '../layoutManager';
import { shouldShowSplitCloseButton } from '../layoutUtils';
import { registerSplitHotkeys } from '../registerSplitHotkeys';
import { createPriorityCollapseController } from './PriorityCollapseOverflowSensor';
import { SplitDrawerGroup } from './SplitDrawerContext';
import { SplitHeader } from './SplitHeader';
import { SplitToolbar } from './SplitToolbar';

type SplitPanelProps = {
  setPanelRef: (ref: HTMLDivElement) => void;
  handle: SplitHandle;
  split: SplitState;
  active: boolean;
  index: number;
};

/**
 * A Preview Pair Viewer displays content passively. Only record it as opened
 * after the user lingers, so keyboard scanning does not mark every row viewed.
 */
const PREVIEW_VIEWER_OPEN_TRACK_DELAY_MS = 1_500;

export function SplitPanel(props: SplitPanelProps) {
  const [attachHotKeys, splitHotkeyScope] = useHotkeyDOMScope(
    `split=${props.split.id}`
  );
  const [panelRef, setPanelRef] = createSignal<HTMLDivElement | null>(null);
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [titleFileMenuRef, setTitleFileMenuRef] =
    createSignal<HTMLDivElement>();
  const [titleFileMenuTrigger, setTitleFileMenuTrigger] =
    createSignal<() => void>();
  const [titleFileMenuActions, setTitleFileMenuActions] =
    createSignal<SplitFileMenuActionGroups>();
  const [bottomPanel, setBottomPanel] =
    createSignal<SplitBottomPanelRegistration>();
  const panelSize = createElementSize(panelRef);

  const layoutRefs: SplitPanelContextType['layoutRefs'] = {};
  const headerCollapseController = createPriorityCollapseController();
  const toolbarCollapseController = createPriorityCollapseController();

  const splitLayoutHelpers = useSplitLayout();

  registerSplitHotkeys({
    // Leaving a piece of content should return you to the list you reached it
    // from, so walk this split's history back to the most recent list view.
    // Only a split that never passed through one falls back to the inbox.
    goToList: () => {
      const wentBack = props.handle.goBackTo(
        (content) => content.type === 'component' && isListViewID(content.id)
      );
      if (wentBack) return;
      props.handle.replace({
        next: { type: 'component', id: LIST_VIEW_ID.inbox },
        referredFrom: 'hotkey',
      });
    },
    isNotUnifiedList: () => {
      const content = props.handle.content();
      return !isListViewID(content.id);
    },
    isViewerSplit: () => props.handle.isViewerSplit(),
    getSplitCount: () => splitLayoutHelpers.getSplitCount(),
    toggleSpotlight: () => props.handle.toggleSpotlight(),
    canGoForward: () => props.handle.canGoForward(),
    insertSplit: splitLayoutHelpers.insertSplit,
    splitName: () => props.handle.displayName(),
    canGoBack: () => props.handle.canGoBack(),
    goForward: () => props.handle.goForward(),
    closeSplit: () => props.handle.close(),
    goBack: () => props.handle.goBack(),
    splitHotkeyScope,
  });

  const nextSoup = createSoupState({
    initialPredicates: { and: ['explicit-noise'] },
  });

  createEffect(
    on([panelRef], () => {
      if (isTouchDevice()) return;
      // Only the active split may claim focus on mount. A Preview Pair's Viewer
      // is created with activate:false while its controller stays active, and
      // must not steal the keyboard from it.
      if (!props.active) return;
      panelRef()?.focus();
    })
  );

  const [toolbarRef, setToolbarRef] = createSignal<HTMLDivElement | null>(null);
  const [headerRef, setHeaderRef] = createSignal<HTMLDivElement | null>(null);
  const toolbarSize = createElementSize(toolbarRef);
  const headerSize = createElementSize(headerRef);

  const [hasToolbarContent, setHasToolbarContent] = createSignal(false);
  onMount(() => {
    const checkContent = () => {
      setHasToolbarContent(
        Boolean(
          layoutRefs.toolbarLeft?.hasChildNodes() ||
            layoutRefs.toolbarRight?.hasChildNodes()
        )
      );
    };
    checkContent();
    const observer = new MutationObserver(checkContent);
    if (layoutRefs.toolbarLeft) {
      observer.observe(layoutRefs.toolbarLeft, { childList: true });
    }
    if (layoutRefs.toolbarRight) {
      observer.observe(layoutRefs.toolbarRight, { childList: true });
    }
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const safeTop = isTouchDevice() ? getSafeAreaInset('top') : 0;
    const offset =
      safeTop + (headerSize.height ?? 0) + (toolbarSize.height ?? 0);
    setContentOffsetTop(offset);
  });

  function multipleSplits() {
    const splits = globalSplitManager()?.splits?.();
    return Boolean(splits && splits.length > 1);
  }

  // On mobile the header stays visible for list views too: it hosts the
  // floating filter-pill strip (see MobileSoupViewTabs).
  const shouldHideSplitHeader = createMemo(() => isSoloSettings());

  const splitFocusStyling = () =>
    !isTouchDevice() &&
    props.active &&
    multipleSplits() &&
    !props.handle.isSpotLight();

  const splitUnfocusedStyling = () =>
    !isTouchDevice() && !props.active && multipleSplits();

  const gutterSize = () =>
    globalSplitManager()?.resizeContext()?.gutterSize() ?? 0;

  /**
   * This split is a Viewer sitting immediately right of its Controller: the
   * pane slides left across the gutter so it sits flush against the
   * Controller, reading as tucked behind it.
   */
  const tuckedBehindController = createMemo(() => {
    return (
      !isTouchDevice() &&
      !props.handle.isSpotLight() &&
      props.handle.isViewerSplit()
    );
  });

  /**
   * This split is a preview controller with its viewer tucked flush against
   * its right edge: paint above the viewer so the controller's card and
   * shadow read as being in front.
   */
  const hasTuckedViewer = createMemo(() => {
    return (
      !isTouchDevice() &&
      !props.handle.isSpotLight() &&
      props.handle.isControllerSplit()
    );
  });

  /**
   * When either member of a tucked Preview Pair is active, the active member
   * stays solid and its partner is dashed. Both retain the standard edge color.
   */
  const previewPairFocusStyling = createMemo(() => {
    const manager = globalSplitManager();
    if (!manager || isTouchDevice() || props.handle.isSpotLight()) return false;

    const peerId = props.handle.isControllerSplit()
      ? manager.viewerOf(props.split.id)
      : props.handle.isViewerSplit()
        ? manager.controllerOf(props.split.id)
        : undefined;
    if (!peerId || manager.getSplit(peerId)?.isSpotLight()) return false;

    const activeId = manager.activeSplitId();
    return activeId === props.split.id || activeId === peerId;
  });

  const usesComposableLayout = () =>
    props.split.mount.kind === 'component' &&
    props.split.mount.meta.splitPanelLayout === 'composable';

  const MountedContent = () => (
    <SplitPanelControllerProvider
      controller={{
        canGoBack: props.handle.canGoBack,
        goBack: () => {
          if (splitBackInterceptor()?.()) return;
          props.handle.goBack();
        },
        canGoForward: props.handle.canGoForward,
        goForward: props.handle.goForward,
        canClose: () => {
          const manager = globalSplitManager();
          return manager
            ? shouldShowSplitCloseButton(manager, props.handle)
            : false;
        },
        close: props.handle.close,
      }}
    >
      <Suspense>
        <SoupViewContextProvider soup={nextSoup}>
          <BlockOpenTrackingDelayContext.Provider
            value={
              props.handle.isViewerSplit()
                ? PREVIEW_VIEWER_OPEN_TRACK_DELAY_MS
                : 0
            }
          >
            <Dynamic component={props.split.mount.element} />
          </BlockOpenTrackingDelayContext.Provider>
        </SoupViewContextProvider>
      </Suspense>
    </SplitPanelControllerProvider>
  );

  return (
    <SoupContextProvider soup={nextSoup}>
      <SplitPanelContext.Provider
        value={{
          isPanelActive: () => props.active,
          handle: props.handle,
          setContentOffsetTop,
          contentOffsetTop,
          splitHotkeyScope,
          bottomPanel,
          registerBottomPanel: (panel) => {
            setBottomPanel(panel);
            return () => {
              setBottomPanel((current) =>
                current?.id === panel.id ? undefined : current
              );
            };
          },
          headerCollapser: headerCollapseController.collapser,
          toolbarCollapser: toolbarCollapseController.collapser,
          layoutRefs,
          titleFileMenuRef,
          setTitleFileMenuRef,
          titleFileMenuTrigger,
          setTitleFileMenuTrigger,
          titleFileMenuActions,
          setTitleFileMenuActions,
          panelSize,
          panelRef,
        }}
      >
        <SplitDrawerGroup panelSize={panelSize}>
          <Show when={props.handle.isSpotLight()}>
            <div
              class="fixed inset-0 w-screen h-screen z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"
              onClick={() => props.handle.toggleSpotlight(false)}
            />
            <div class="fixed inset-16 bg-surface shadow-xl" />
          </Show>

          <div
            classList={{
              'fixed inset-16 z-modal-overlay isolate opacity-50':
                props.handle.isSpotLight(),
              'opacity-100': props.active || props.handle.isSpotLight(),
              // touch:isolate contains the floating SplitHeader within the panel's own stacking context, so the root-level mobile/tablet
              // search overlay paints over it.
              'relative size-full touch:isolate': !props.handle.isSpotLight(),
            }}
            style={{
              '--split-header-height': `${
                shouldHideSplitHeader() ? 0 : (headerSize.height ?? 0)
              }px`,
              // The hard spacer for top-anchored content on full-frame
              // mobile/tablet: status bar + floating header strip.
              '--mobile-content-inset-top':
                'calc(var(--safe-top, 0px) + var(--split-header-height, 0px))',
              // Slide the preview pane left across the gutter so it sits
              // flush against the controller, keeping its right edge in
              // place. The gutter's drag hit-area still paints (and
              // hit-tests) above this extension, so resizing works.
              ...(tuckedBehindController() && {
                'margin-left': `-${gutterSize()}px`,
                width: `calc(100% + ${gutterSize()}px)`,
              }),
            }}
            ref={(ref) => {
              setPanelRef(ref);
              props.setPanelRef(ref);
              attachHotKeys(ref);
            }}
            data-split-id={props.split.id}
            {...splitContainerAttribute}
            data-modal={props.handle.isSpotLight()}
            tabindex={-1}
          >
            <Panel
              class={cn(
                'rounded-xl touch:rounded-none touch:after:hidden touch:border-0! bg-panel',
                splitUnfocusedStyling() && 'split-panel-inactive',
                {
                  'shadow-sm shadow-drop-shadow/50': splitUnfocusedStyling(),
                  'shadow-2xl shadow-drop-shadow': splitFocusStyling(),
                  'border-solid!': previewPairFocusStyling() && props.active,
                  'border-dashed!': previewPairFocusStyling() && !props.active,
                  // Drawer look: both members square their seam corners. The
                  // seam border always belongs to the Controller — the
                  // Viewer's seam edge stays borderless so the line never
                  // doubles, and keeping it on one fixed member regardless
                  // of focus means switching focus can't shift layout by the
                  // border width (the ! beats Surface's inline border
                  // shorthand).
                  'rounded-l-none border-l-0!': tuckedBehindController(),
                  'rounded-r-none': hasTuckedViewer(),
                }
              )}
              depth={isTouchDevice() ? 0 : 1}
            >
              <Show
                when={usesComposableLayout()}
                fallback={
                  <>
                    <Panel.Header
                      class={cn(
                        'relative block min-h-10.25 touch:min-h-11.25 p-0 overflow-visible border-b-0!',
                        'z-split-panel-chrome',
                        // On mobile/tablet the header collapses to a zero-height grid row;
                        // SplitHeader overlays the body as floating islands.
                        'touch:min-h-0 touch:border-b-0',
                        shouldHideSplitHeader() && 'hidden'
                      )}
                    >
                      <SplitHeader
                        ref={setHeaderRef}
                        collapseController={headerCollapseController}
                      />
                    </Panel.Header>

                    <Panel.Toolbar
                      class={cn(
                        'items-start overflow-visible',
                        !hasToolbarContent() && 'hidden',
                        isTouchDevice() && 'hidden',
                        'border-b-0'
                      )}
                    >
                      <SplitToolbar
                        ref={setToolbarRef}
                        collapseController={toolbarCollapseController}
                      />
                    </Panel.Toolbar>

                    <Panel.Body>
                      <div class="@container/split size-full min-h-0 overflow-hidden relative flex flex-col">
                        <div
                          class={cn(
                            'min-h-0 min-w-0 overflow-hidden relative',
                            bottomPanel() ? 'h-1/2' : 'h-full'
                          )}
                        >
                          <MountedContent />
                        </div>
                        <Show when={bottomPanel()}>
                          {(panel) => (
                            <div class="h-1/2 min-h-0 min-w-0 border-t border-edge-muted bg-surface flex flex-col">
                              <div class="flex h-10 shrink-0 items-center gap-2 border-b border-edge-muted px-2">
                                <h3 class="min-w-0 flex-1 truncate text-sm font-medium text-ink-muted">
                                  {panel().title}
                                </h3>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  label="Close"
                                  onClick={() => panel().onClose?.()}
                                >
                                  <CloseIcon />
                                </Button>
                              </div>
                              <div class="min-h-0 flex-1 overflow-hidden">
                                {panel().content()}
                              </div>
                            </div>
                          )}
                        </Show>
                      </div>
                      <MobileTopEdgeFade />
                    </Panel.Body>
                  </>
                }
              >
                <div
                  class="size-full min-h-0 min-w-0 overflow-hidden"
                  style={{ 'grid-area': '1 / 1 / -1 / -1' }}
                >
                  <MountedContent />
                </div>
              </Show>
            </Panel>
          </div>
        </SplitDrawerGroup>
      </SplitPanelContext.Provider>
    </SoupContextProvider>
  );
}
