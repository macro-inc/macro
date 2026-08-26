import { activeAppLayout } from '@app/features/app-layout/layout-state';
import { splitsSitBesideChromeRail } from '@app/features/app-layout/split-chrome';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import {
  isSidebarVisible,
  useSidebarCollapse,
} from '@components/app/sidebarVisibility';
import { Resize } from '@core/component/Resize';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { tabTitleSignal } from '@core/signal/tabTitle';
import { useWindowSize } from '@solid-primitives/resize-observer';
import { useLocation, useNavigate } from '@solidjs/router';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSelector,
  For,
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
  type SplitId,
  type SplitManager,
} from './layoutManager';
import { createLayoutUrlSync, restorePreviewPairs } from './layoutUrlSync';
import {
  createMobileSwipeLayout,
  type MobileSwipeLayout,
} from './mobile/createMobileSwipeLayout';
import { MobileSplitContainer } from './mobile/MobileSplitContainer';
import {
  loadRestorablePreviewLayout,
  PREVIEW_QUERY_PARAM,
} from './previewPersistence';
import { splitMinWidthForContent } from './splitContentSizing';
import { createSplitFocusTracker } from './splitFocusTracker';

/** The gap between floating split cards. */
const CARD_GUTTER_PX = 8;
/** One border width, so a flat layout's seam matches every other hairline. */
const SEAM_GUTTER_PX = 1;
/** Widens the hairline's drag target without widening the seam itself. */
const SEAM_GUTTER_HIT_SLOP_PX = 4;

type SplitLayoutContainerProps = {
  pairs: string[];
  setManager: Setter<SplitManager | undefined>;
  serializePath?: (segments: string[]) => string;
};

export function SplitLayoutContainer(props: SplitLayoutContainerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const viewportSize = useWindowSize();
  const previewQuery = () => location.query[PREVIEW_QUERY_PARAM];
  const decodedLayout = createMemo(() =>
    loadRestorablePreviewLayout(props.pairs, previewQuery(), {
      allowPreviewPairs: !isTouchDevice(),
    })
  );
  const initialLayout = decodedLayout();
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const splitManager = createSplitLayout(
    blockOrchestrator,
    initialLayout.contents
  );
  restorePreviewPairs(splitManager, initialLayout.previewPairs);
  const [, setTabTitle] = tabTitleSignal;
  const sidebar = useSidebarCollapse();

  // Create the mobile swipe layout once on mobile devices.
  const mobileSwipeLayout: MobileSwipeLayout | undefined =
    isNativeMobilePlatform()
      ? createMobileSwipeLayout(splitManager)
      : undefined;

  // Store a ref to each panel by id
  const panelRefs = new Map<SplitId, HTMLDivElement>();

  const splits = createMemo(splitManager.splits);

  // Drop refs for departed splits by reconciling against the live list:
  // batched mutations can remove several splits in one flush (e.g. closing
  // a Preview Pair), and the events signal only surfaces the last event.
  createEffect(() => {
    const alive = new Set(splits().map(({ id }) => id));
    for (const id of panelRefs.keys()) {
      if (!alive.has(id)) panelRefs.delete(id);
    }
  });

  const activeSplitSelector = createSelector(splitManager.activeSplitId);

  createEffect(() => props.setManager(splitManager));

  onCleanup(() => props.setManager(undefined));

  createEffect(() => {
    setTabTitle(splitManager.tabTitle());
  });

  // <For> on plain ids for stable referential equality
  const ids = createMemo(() => splits().map(({ id }) => id));

  /**
   * Flat layouts drop the card look: the zone paints the seam color, the
   * panels sit flush on top of it, and each resize gutter narrows to a
   * hairline so all that shows through is one border-width line.
   */
  const flatSeams = () => activeAppLayout().capabilities.flatSplitSeams;

  createLayoutUrlSync(
    splitManager,
    () => props.pairs,
    previewQuery,
    decodedLayout,
    {
      navigate,
      search: () => location.search,
      hash: () => location.hash,
      serializePath: (segments) =>
        props.serializePath?.(segments) ?? `/${segments.join('/')}`,
    }
  );
  createSplitFocusTracker({ splitManager, panelRefs, splits });

  return (
    <SplitLayoutContext.Provider value={{ manager: splitManager }}>
      <div
        class={cn('size-full p-2 touch:p-0', {
          'pl-0':
            !flatSeams() &&
            isSidebarVisible() &&
            splitsSitBesideChromeRail() &&
            (!sidebar.isCollapsed() ||
              activeAppLayout().capabilities.removesSplitContentLeftPadding),
          // No rail on the left, so the cards open the page with a margin
          // rather than hugging the window edge.
          'pl-4': !flatSeams() && !splitsSitBesideChromeRail(),
          'bg-edge-muted p-0': flatSeams(),
        })}
      >
        <Show
          when={isNativeMobilePlatform() && mobileSwipeLayout}
          fallback={
            // Desktop: side-by-side resizable splits.
            <Resize.Zone
              direction="horizontal"
              gutter={flatSeams() ? SEAM_GUTTER_PX : CARD_GUTTER_PX}
              gutterHitSlop={flatSeams() ? SEAM_GUTTER_HIT_SLOP_PX : 0}
              captureResizeCtx={splitManager.setResizeContext}
            >
              <For each={ids()}>
                {(id, index) => (
                  <Show when={splitManager.getSplit(id)}>
                    {(handle) => (
                      <Suspense>
                        <Resize.Panel
                          id={id}
                          minSize={splitMinWidthForContent(handle().content(), {
                            isPreviewController: handle().isControllerSplit(),
                          })}
                          // A Preview Pair is one layout unit: its two splits
                          // share the space a single split would get. Both
                          // members key their group by the Controller's id.
                          shareGroup={
                            splitManager.viewerOf(id) !== undefined
                              ? id
                              : splitManager.controllerOf(id)
                          }
                          // Automatic redistribution targets an engaged
                          // Controller at its configured preferred width.
                          // This is not a hard max: the gutter can still be
                          // dragged past it.
                          redistributionPreferredSize={splitManager.previewControllerWidth(
                            id,
                            viewportSize.width
                          )}
                          index={index()}
                        >
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
          <MobileSplitContainer
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
